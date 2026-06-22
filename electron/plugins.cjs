// 插件管理器（主进程）：在 userData/plugins 下管理外部工具插件的安装/启停/更新/卸载。
// 每个插件一个目录：<userData>/plugins/<id>/ 含 manifest.json + 入口 bundle(+资源)。
// registry.json 记录每个插件的启用状态与来源（github / local）。
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

function setupPlugins({ ipcMain, app, dialog, getWin }) {
  const root = path.join(app.getPath('userData'), 'plugins')
  const indexFile = path.join(root, 'registry.json')
  fs.mkdirSync(root, { recursive: true })

  const readIndex = () => {
    try {
      return JSON.parse(fs.readFileSync(indexFile, 'utf8'))
    } catch {
      return {}
    }
  }
  const writeIndex = (idx) => fs.writeFileSync(indexFile, JSON.stringify(idx, null, 2))
  const ROOT_RESOLVED = path.resolve(root)
  // 防目录穿越：id 只允许字母数字和 . _ -，且显式拒绝 "." / ".."
  const safeId = (id) => (typeof id === 'string' && id !== '.' && id !== '..' && /^[A-Za-z0-9._-]+$/.test(id) ? id : null)
  // 插件目录：拼接后兜底校验仍严格位于 root 之内（不等于 root 本身）
  const pluginDir = (id) => {
    const d = path.join(root, id)
    const r = path.resolve(d)
    if (r === ROOT_RESOLVED || !r.startsWith(ROOT_RESOLVED + path.sep)) throw new Error('非法插件路径')
    return d
  }
  // 把插件内相对资源安全拼接，禁止逃出插件目录（用于 entry / icon 等 manifest 可控字段）
  const safeJoin = (baseDir, rel) => {
    const base = path.resolve(baseDir)
    const p = path.resolve(baseDir, String(rel))
    if (p !== base && !p.startsWith(base + path.sep)) throw new Error('非法资源路径')
    return p
  }

  // 开发者链接（local-link）来源时，插件文件直接从外部开发目录读取（不复制进 userData），
  // 使「改代码 → 重新构建 → 重载窗口」即时生效，无需重装。其余来源读 userData 内的副本。
  const linkedPath = (id) => {
    const rec = readIndex()[id]
    return rec && rec.source && rec.source.type === 'local-link' && typeof rec.source.path === 'string' ? rec.source.path : null
  }
  const resolveDir = (id) => {
    const linked = linkedPath(id)
    return linked ? path.resolve(linked) : pluginDir(id)
  }

  // 解析 bundle / 图标等资源：优先所选目录根，回退其 dist/ 子目录。
  // 兼容「manifest.json 在项目根、构建产物在 dist/」这一最常见布局——开发者链接到项目根时，
  // manifest 从根读（稳定、不被 emptyOutDir 清掉），bundle 从 dist/ 读（每次构建刷新，实时热重载）。
  const resolveAsset = (baseDir, rel) => {
    const a = safeJoin(baseDir, rel)
    if (fs.existsSync(a)) return a
    const b = safeJoin(baseDir, path.join('dist', rel))
    return fs.existsSync(b) ? b : a // 都没有则返回首选，让 readFile 抛带明确路径的 ENOENT
  }

  async function readManifest(id) {
    return JSON.parse(await fsp.readFile(path.join(resolveDir(id), 'manifest.json'), 'utf8'))
  }

  async function iconDataUrl(id, manifest) {
    if (!manifest.icon || /^data:/.test(manifest.icon)) return manifest.icon
    try {
      const buf = await fsp.readFile(resolveAsset(resolveDir(id), manifest.icon))
      const ext = path.extname(manifest.icon).slice(1).toLowerCase()
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + (ext || 'png')
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      return undefined
    }
  }

  // ---- 查询 ----
  // 合并两个来源：① registry.json 里登记的插件（含开发者链接，文件在外部目录）；
  // ② userData/plugins 下未登记的「拖入式」目录（手动放入的）。按 id 去重。
  ipcMain.handle('plugins:list', async () => {
    const idx = readIndex()
    const out = []
    const seen = new Set()
    const push = async (id, rec) => {
      if (!safeId(id) || seen.has(id)) return
      try {
        const manifest = await readManifest(id)
        manifest.id = id
        manifest.icon = await iconDataUrl(id, manifest)
        out.push({ manifest, enabled: rec.enabled !== false, source: rec.source || null })
        seen.add(id)
      } catch {
        /* 跳过损坏 / 链接目录已失效的插件 */
      }
    }
    for (const id of Object.keys(idx)) await push(id, idx[id])
    let entries = []
    try {
      entries = await fsp.readdir(root, { withFileTypes: true })
    } catch {
      /* ignore */
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      await push(e.name, idx[e.name] || {})
    }
    return out
  })

  // 渲染层读取 bundle 源码 → blob 注入加载
  ipcMain.handle('plugins:readBundle', async (_e, { id }) => {
    if (!safeId(id)) throw new Error('非法插件 id')
    const manifest = await readManifest(id)
    const entry = manifest.entry || 'tool.js'
    return fsp.readFile(resolveAsset(resolveDir(id), entry), 'utf8')
  })

  ipcMain.handle('plugins:setEnabled', (_e, { id, enabled }) => {
    const idx = readIndex()
    idx[id] = { ...(idx[id] || {}), enabled: !!enabled }
    writeIndex(idx)
    return true
  })

  ipcMain.handle('plugins:remove', async (_e, { id }) => {
    if (!safeId(id)) throw new Error('非法插件 id')
    // 始终清理 userData 内的副本目录：pluginDir(id) 恒指向 <userData>/plugins/<id>，
    // 绝不等于开发者链接(local-link)的外部目录（外部目录不在 pluginDir 路径下），故删它不会误删外部目录。
    // 必须无条件删，否则当某 id 既是 local-link、userData 又恰好有同名「拖入式/复制残留」目录时，
    // 旧逻辑(!linkedPath 才删)会跳过清理，卸载后 list 会把该影子目录当未登记插件重新冒出（同 id 复活并被注入执行）。
    await fsp.rm(pluginDir(id), { recursive: true, force: true })
    const idx = readIndex()
    delete idx[id]
    writeIndex(idx)
    return true
  })

  // 读取所选文件夹的 manifest 并定位入口文件。最大限度宽容用户选哪个文件夹：
  //  - manifest.json 在所选目录 → 用它；
  //  - 所选目录没有但其「父目录」有（用户选了 dist/，manifest 在项目根）→ 用父目录的 manifest；
  //  - 入口文件可在 manifest 所在目录、所选目录、或 manifest 目录的 dist/ 子目录。
  // 覆盖：选项目根、选自包含 dist/、选只含 bundle 的 dist/（manifest 在父级）三种布局。
  async function readDirManifest(dir) {
    const parent = path.dirname(dir)
    let manifestDir = null
    if (fs.existsSync(path.join(dir, 'manifest.json'))) manifestDir = dir
    else if (parent && parent !== dir && fs.existsSync(path.join(parent, 'manifest.json'))) manifestDir = parent
    if (!manifestDir) {
      throw new Error('找不到 manifest.json：请选择插件「项目根目录」（含 manifest.json），或其 dist 子文件夹')
    }
    let manifest
    try {
      manifest = JSON.parse(await fsp.readFile(path.join(manifestDir, 'manifest.json'), 'utf8'))
    } catch (e) {
      throw new Error('manifest.json 解析失败：' + (e && e.message ? e.message : String(e)))
    }
    const id = safeId(manifest.id)
    if (!id) throw new Error('manifest.id 非法或缺失')
    const entry = manifest.entry || 'tool.js'
    // 入口所在目录候选：所选目录、manifest 目录、manifest 目录的 dist/
    const cands = [dir, manifestDir, path.join(manifestDir, 'dist')]
    const entryDir = cands.find((d) => fs.existsSync(path.join(d, entry))) || null
    if (!entryDir) throw new Error(`入口文件 ${entry} 不存在（已查所选目录与其 dist/）；请先运行 npm run build`)
    return { manifest, id, entry, entryDir, manifestDir }
  }

  // ---- 本地安装（开发者模式 · 复制）：把所选文件夹复制进 userData，落地为自包含目录 ----
  async function installFromDir(dir) {
    const { manifest, id, entry, entryDir, manifestDir } = await readDirManifest(dir)
    const dest = pluginDir(id)
    await fsp.rm(dest, { recursive: true, force: true })
    await fsp.mkdir(dest, { recursive: true })
    if (path.resolve(entryDir) === path.resolve(manifestDir)) {
      // manifest 与入口同目录（自包含 dist/ 或平铺）：复制该目录，仅跳过紧邻根的顶层开发垃圾。
      // 按相对源根首段判断、永不跳过根本身——否则选中名为 src 的目录会令根被过滤、复制为空。
      const base = path.resolve(entryDir)
      const skip = new Set(['node_modules', '.git', 'src', '.vscode', '.idea'])
      await fsp.cp(entryDir, dest, {
        recursive: true,
        filter: (src) => {
          const rel = path.relative(base, path.resolve(src))
          return rel === '' || !skip.has(rel)
        },
      })
    } else {
      // manifest 与入口分处不同目录（manifest 在根、产物在 dist/）：复制入口目录/* + manifest.json，使 dest 自包含
      await fsp.cp(entryDir, dest, { recursive: true })
      await fsp.copyFile(path.join(manifestDir, 'manifest.json'), path.join(dest, 'manifest.json'))
    }
    // 断言入口确实落地，把「静默空复制」变成明确错误而非延迟到 readBundle 才 ENOENT
    if (!fs.existsSync(safeJoin(dest, entry))) throw new Error(`复制后入口 ${entry} 缺失，请确认所选文件夹完整`)
    const idx = readIndex()
    idx[id] = { enabled: true, source: { type: 'local', path: dir } }
    writeIndex(idx)
    return { id, manifest }
  }

  // ---- 开发者链接（开发者模式 · 不复制）：链接到 manifest 所在目录，bundle 经 dist/ 回退实时读取 ----
  async function installLinkDir(dir) {
    const { manifest, id, manifestDir } = await readDirManifest(dir)
    // 链接到 manifest 所在目录（项目根或自包含 dist）；readBundle 会用 resolveAsset 回退到 dist/ 找入口。
    const linkDir = manifestDir
    // 同 id 若已有复制安装的副本，清掉以免与链接冲突
    await fsp.rm(pluginDir(id), { recursive: true, force: true }).catch(() => {})
    const idx = readIndex()
    idx[id] = { enabled: true, source: { type: 'local-link', path: path.resolve(linkDir) } }
    writeIndex(idx)
    return { id, manifest }
  }

  // 注：devMode 仅是渲染层 UI 收纳（localStorage 开关），非安全门禁——下面两个 handler 无条件注册，
  // 程序化调用绕得过 UI。本地安装/链接的真正门禁是强制弹出的原生文件夹选择对话框（需用户显式选择，
  // 安装路径只来自对话框、绝不取调用方参数），加上受信任插件模型（插件本就同宿主权限）。
  ipcMain.handle('plugins:installLocal', async () => {
    const res = await dialog.showOpenDialog(getWin && getWin(), {
      title: '选择插件项目根目录或 dist 文件夹（含 manifest.json）',
      properties: ['openDirectory'],
    })
    if (res.canceled || !res.filePaths[0]) return { canceled: true }
    console.log('[ttool] installLocal 选择:', res.filePaths[0])
    try {
      const r = await installFromDir(res.filePaths[0])
      console.log('[ttool] installLocal 成功:', r.id)
      return { canceled: false, ...r }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[ttool] installLocal 失败:', msg)
      return { canceled: false, error: msg }
    }
  })

  ipcMain.handle('plugins:installLocalLink', async () => {
    const res = await dialog.showOpenDialog(getWin && getWin(), {
      title: '选择插件项目根目录或 dist 文件夹做开发者链接（改代码→重新构建→Ctrl+R 重载即生效）',
      properties: ['openDirectory'],
    })
    if (res.canceled || !res.filePaths[0]) return { canceled: true }
    console.log('[ttool] installLocalLink 选择:', res.filePaths[0])
    try {
      const r = await installLinkDir(res.filePaths[0])
      console.log('[ttool] installLocalLink 成功:', r.id, '→', readIndex()[r.id] && readIndex()[r.id].source.path)
      return { canceled: false, ...r }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[ttool] installLocalLink 失败:', msg)
      return { canceled: false, error: msg }
    }
  })

  // ---- GitHub Release 安装 ----
  const GH_HEADERS = { 'User-Agent': 'ttool-app', Accept: 'application/vnd.github+json' }
  async function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms || 20000)
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal })
    } finally {
      clearTimeout(t)
    }
  }
  async function ghJson(url) {
    const res = await fetchWithTimeout(url, { headers: GH_HEADERS })
    if (!res.ok) throw new Error('GitHub API ' + res.status + (res.status === 403 ? '（可能触发匿名速率限制，稍后再试）' : ''))
    return res.json()
  }
  async function download(url, dest) {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'ttool-app', Accept: 'application/octet-stream' }, redirect: 'follow' }, 60000)
    if (!res.ok) throw new Error('下载失败 ' + res.status)
    await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()))
  }

  async function installGithub({ repo, tag }) {
    const clean = String(repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '')
    if (!/^[^/]+\/[^/]+$/.test(clean)) throw new Error('仓库格式应为 owner/repo')
    const rel = await ghJson(`https://api.github.com/repos/${clean}/releases/${tag ? 'tags/' + encodeURIComponent(tag) : 'latest'}`)
    const assets = rel.assets || []
    const manifestAsset = assets.find((a) => a.name === 'manifest.json')
    if (!manifestAsset) throw new Error('该 release 缺少 manifest.json 资产')
    const tmp = path.join(root, '.tmp-' + Date.now())
    await fsp.mkdir(tmp, { recursive: true })
    try {
      await download(manifestAsset.browser_download_url, path.join(tmp, 'manifest.json'))
      const manifest = JSON.parse(await fsp.readFile(path.join(tmp, 'manifest.json'), 'utf8'))
      const id = safeId(manifest.id)
      if (!id) throw new Error('manifest.id 非法或缺失')
      for (const a of assets) {
        if (a.name === 'manifest.json') continue
        // 资产名只允许平铺文件名，禁止路径分隔符 / .. （纵深防御：防资产名穿越逃出 tmp 写盘）
        if (/[\\/]/.test(a.name) || a.name === '.' || a.name === '..') continue
        await download(a.browser_download_url, safeJoin(tmp, a.name))
      }
      const dest = pluginDir(id)
      await fsp.rm(dest, { recursive: true, force: true })
      try {
        await fsp.rename(tmp, dest)
      } catch {
        await fsp.cp(tmp, dest, { recursive: true })
        await fsp.rm(tmp, { recursive: true, force: true })
      }
      const idx = readIndex()
      idx[id] = { enabled: true, source: { type: 'github', repo: clean, tag: tag || null } }
      writeIndex(idx)
      return { id, manifest, version: manifest.version }
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }

  ipcMain.handle('plugins:installGithub', async (_e, args) => {
    try {
      return { ok: true, ...(await installGithub(args)) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('plugins:update', async (_e, { id }) => {
    const src = readIndex()[id]?.source
    if (src?.type === 'github') {
      try {
        return { ok: true, ...(await installGithub({ repo: src.repo, tag: src.tag })) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
    if (src?.type === 'local-link') return { ok: false, error: '开发者链接插件：改代码后重新构建并按 Ctrl+R 重载窗口即生效，无需更新' }
    return { ok: false, error: '该插件非 GitHub 来源，无法自动更新（本地复制安装请重新安装）' }
  })
}

module.exports = { setupPlugins }
