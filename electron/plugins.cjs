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

  async function readManifest(id) {
    return JSON.parse(await fsp.readFile(path.join(pluginDir(id), 'manifest.json'), 'utf8'))
  }

  async function iconDataUrl(id, manifest) {
    if (!manifest.icon || /^data:/.test(manifest.icon)) return manifest.icon
    try {
      const buf = await fsp.readFile(safeJoin(pluginDir(id), manifest.icon))
      const ext = path.extname(manifest.icon).slice(1).toLowerCase()
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + (ext || 'png')
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      return undefined
    }
  }

  // ---- 查询 ----
  ipcMain.handle('plugins:list', async () => {
    const idx = readIndex()
    const out = []
    let entries = []
    try {
      entries = await fsp.readdir(root, { withFileTypes: true })
    } catch {
      /* ignore */
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const id = e.name
      try {
        const manifest = await readManifest(id)
        manifest.id = id
        manifest.icon = await iconDataUrl(id, manifest)
        const rec = idx[id] || {}
        out.push({ manifest, enabled: rec.enabled !== false, source: rec.source || null })
      } catch {
        /* 跳过损坏的插件目录 */
      }
    }
    return out
  })

  // 渲染层读取 bundle 源码 → blob 注入加载
  ipcMain.handle('plugins:readBundle', async (_e, { id }) => {
    if (!safeId(id)) throw new Error('非法插件 id')
    const manifest = await readManifest(id)
    const entry = manifest.entry || 'tool.js'
    return fsp.readFile(safeJoin(pluginDir(id), entry), 'utf8')
  })

  ipcMain.handle('plugins:setEnabled', (_e, { id, enabled }) => {
    const idx = readIndex()
    idx[id] = { ...(idx[id] || {}), enabled: !!enabled }
    writeIndex(idx)
    return true
  })

  ipcMain.handle('plugins:remove', async (_e, { id }) => {
    if (!safeId(id)) throw new Error('非法插件 id')
    await fsp.rm(pluginDir(id), { recursive: true, force: true })
    const idx = readIndex()
    delete idx[id]
    writeIndex(idx)
    return true
  })

  // ---- 本地安装（开发者模式）：选含 manifest.json 的文件夹 ----
  async function installFromDir(dir) {
    const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8'))
    const id = safeId(manifest.id)
    if (!id) throw new Error('manifest.id 非法或缺失')
    const dest = pluginDir(id)
    await fsp.rm(dest, { recursive: true, force: true })
    await fsp.mkdir(dest, { recursive: true })
    await fsp.cp(dir, dest, { recursive: true })
    const idx = readIndex()
    idx[id] = { enabled: true, source: { type: 'local', path: dir } }
    writeIndex(idx)
    return { id, manifest }
  }

  ipcMain.handle('plugins:installLocal', async () => {
    const res = await dialog.showOpenDialog(getWin && getWin(), {
      title: '选择插件文件夹（需含 manifest.json 与入口 bundle）',
      properties: ['openDirectory'],
    })
    if (res.canceled || !res.filePaths[0]) return { canceled: true }
    try {
      const r = await installFromDir(res.filePaths[0])
      return { canceled: false, ...r }
    } catch (e) {
      return { canceled: false, error: e instanceof Error ? e.message : String(e) }
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
        await download(a.browser_download_url, path.join(tmp, a.name))
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
    return { ok: false, error: '该插件非 GitHub 来源，无法自动更新（本地插件请重新安装）' }
  })
}

module.exports = { setupPlugins }
