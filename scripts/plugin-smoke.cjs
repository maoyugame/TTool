// 插件安装链路真实验收：直接驱动 plugins.cjs 的真实 installLocal(复制)/installLocalLink(链接)/
// readBundle/list/remove，用一个内存 ipcMain 桩 + 临时 userData。覆盖之前被 seed-plugin 绕过的真实路径。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setupPlugins } = require('../electron/plugins.cjs')

const USER_DATA = path.join(os.tmpdir(), 'ttool-plugin-smoke')
fs.rmSync(USER_DATA, { recursive: true, force: true })
fs.mkdirSync(USER_DATA, { recursive: true })

// ipcMain 桩：记录 handler，invoke(channel, payload) 直接调用
const handlers = {}
const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn } }
const invoke = (ch, payload) => handlers[ch]({}, payload)

// dialog 桩：返回预设文件夹
let nextDir = null
const dialog = { showOpenDialog: async () => (nextDir ? { canceled: false, filePaths: [nextDir] } : { canceled: true }) }
const app = { getPath: () => USER_DATA }

setupPlugins({ ipcMain, app, dialog, getWin: () => null })

const HELLO_DIST = path.resolve(__dirname, '..', 'examples', 'hello-tool', 'dist')
let pass = true
const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) pass = false }

;(async () => {
  // 前置：确保 example 已构建且 dist 自包含
  check('dist 自包含(manifest+tool.js)', fs.existsSync(path.join(HELLO_DIST, 'manifest.json')) && fs.existsSync(path.join(HELLO_DIST, 'tool.js')))

  // 1) 复制安装：选 dist/ → 真实 cp → readBundle 应拿到 tool.js 源码
  nextDir = HELLO_DIST
  const inst = await invoke('plugins:installLocal')
  check('installLocal 成功', inst && !inst.error && inst.id === 'hello')
  const copied = fs.existsSync(path.join(USER_DATA, 'plugins', 'hello', 'tool.js'))
  check('复制到 userData/plugins/hello/tool.js', copied)
  const bundle = await invoke('plugins:readBundle', { id: 'hello' })
  check('readBundle 取到非空源码', typeof bundle === 'string' && bundle.length > 50)
  const listed = await invoke('plugins:list')
  check('list 含 hello(source=local)', listed.some((p) => p.manifest.id === 'hello' && p.source && p.source.type === 'local'))

  // 2) 宽容解析：选项目根(manifest 在根、产物在 dist/)也应成功安装（不再报错）
  await invoke('plugins:remove', { id: 'hello' })
  const PROJ_ROOT = path.resolve(__dirname, '..', 'examples', 'hello-tool')
  nextDir = PROJ_ROOT
  const rootInst = await invoke('plugins:installLocal')
  check('选项目根也能成功安装(宽容解析)', rootInst && !rootInst.error && rootInst.id === 'hello')
  check('选项目根 readBundle 成功', typeof (await invoke('plugins:readBundle', { id: 'hello' })) === 'string')
  // 真正无效：选一个完全没有 manifest.json 的文件夹 → 明确报错
  const NOMF = path.join(os.tmpdir(), 'ttool-plugin-smoke-nomf')
  fs.rmSync(NOMF, { recursive: true, force: true })
  fs.mkdirSync(NOMF, { recursive: true })
  nextDir = NOMF
  const noMf = await invoke('plugins:installLocal')
  check('无 manifest 文件夹 → 明确错误', noMf && noMf.error && /manifest/.test(noMf.error))
  // 复位：恢复 hello 为复制安装态供后续用例
  await invoke('plugins:remove', { id: 'hello' })
  nextDir = HELLO_DIST
  await invoke('plugins:installLocal')

  // 3) 开发者链接：不复制，直接从外部 dist 读
  await invoke('plugins:remove', { id: 'hello' })
  nextDir = HELLO_DIST
  const link = await invoke('plugins:installLocalLink')
  check('installLocalLink 成功', link && !link.error && link.id === 'hello')
  const notCopied = !fs.existsSync(path.join(USER_DATA, 'plugins', 'hello', 'tool.js'))
  check('链接模式不复制到 userData', notCopied)
  const linkBundle = await invoke('plugins:readBundle', { id: 'hello' })
  check('链接模式 readBundle 取到源码', typeof linkBundle === 'string' && linkBundle.length > 50)
  const listed2 = await invoke('plugins:list')
  check('list 含 hello(source=local-link)', listed2.some((p) => p.manifest.id === 'hello' && p.source && p.source.type === 'local-link'))

  // 4) 链接「实时」：改 dist/tool.js 后无需重装，readBundle 立即反映
  const toolFile = path.join(HELLO_DIST, 'tool.js')
  const orig = fs.readFileSync(toolFile, 'utf8')
  try {
    fs.writeFileSync(toolFile, orig + '\n/*LIVE-EDIT-MARKER*/')
    const edited = await invoke('plugins:readBundle', { id: 'hello' })
    check('链接模式实时反映改动(免重装)', edited.includes('LIVE-EDIT-MARKER'))
  } finally {
    fs.writeFileSync(toolFile, orig) // 还原，避免污染 example
  }

  // 5) 链接 remove 不删除外部 dist 目录
  await invoke('plugins:remove', { id: 'hello' })
  check('链接 remove 后外部 dist 仍在', fs.existsSync(toolFile))

  // 6) 影子复活防护：local-link 登记 + userData 同名拖入目录 → remove 后不复活
  {
    const shadowDir = path.join(USER_DATA, 'plugins', 'collide')
    fs.mkdirSync(shadowDir, { recursive: true })
    fs.writeFileSync(path.join(shadowDir, 'tool.js'), '/*shadow*/')
    fs.writeFileSync(path.join(shadowDir, 'manifest.json'), JSON.stringify({ id: 'collide', name: 'SHADOW', glyph: 'x', cat: '插件', hue: 'gray', version: '0', entry: 'tool.js', sdk: '1' }))
    // 登记成 local-link 指向外部 dist（与影子目录同 id）
    const idxFile = path.join(USER_DATA, 'plugins', 'registry.json')
    const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'))
    idx.collide = { enabled: true, source: { type: 'local-link', path: HELLO_DIST } }
    fs.writeFileSync(idxFile, JSON.stringify(idx))
    await invoke('plugins:remove', { id: 'collide' })
    const after = await invoke('plugins:list')
    check('remove 后影子目录不复活', !after.some((p) => p.manifest.id === 'collide'))
    check('remove 清掉了 userData 影子目录', !fs.existsSync(shadowDir))
  }

  // 7) 复制 filter：选中名为 src 的文件夹不应静默空复制（断言入口落地）
  {
    const srcDir = path.join(os.tmpdir(), 'ttool-plugin-smoke-src', 'src')
    fs.rmSync(path.dirname(srcDir), { recursive: true, force: true })
    fs.mkdirSync(srcDir, { recursive: true })
    fs.copyFileSync(path.join(HELLO_DIST, 'tool.js'), path.join(srcDir, 'tool.js'))
    fs.writeFileSync(path.join(srcDir, 'manifest.json'), JSON.stringify({ id: 'insrc', name: 'InSrc', glyph: 's', cat: '插件', hue: 'gray', version: '1', entry: 'tool.js', sdk: '1' }))
    nextDir = srcDir
    const r = await invoke('plugins:installLocal')
    const ok = r && !r.error && fs.existsSync(path.join(USER_DATA, 'plugins', 'insrc', 'tool.js'))
    check('选名为 src 的文件夹仍正确复制入口', ok)
  }

  // 8) 复制 filter：dist 深层名为 src 的合法资源目录不被误删
  {
    const dd = path.join(os.tmpdir(), 'ttool-plugin-smoke-nested')
    fs.rmSync(dd, { recursive: true, force: true })
    fs.mkdirSync(path.join(dd, 'assets', 'src'), { recursive: true })
    fs.copyFileSync(path.join(HELLO_DIST, 'tool.js'), path.join(dd, 'tool.js'))
    fs.writeFileSync(path.join(dd, 'assets', 'src', 'needed.png'), 'PNGDATA')
    fs.writeFileSync(path.join(dd, 'manifest.json'), JSON.stringify({ id: 'nested', name: 'Nested', glyph: 'n', cat: '插件', hue: 'gray', version: '1', entry: 'tool.js', sdk: '1' }))
    nextDir = dd
    await invoke('plugins:installLocal')
    check('dist 深层 assets/src 合法资源不被误删', fs.existsSync(path.join(USER_DATA, 'plugins', 'nested', 'assets', 'src', 'needed.png')))
  }

  // 9) 真实用户布局：manifest 在项目根、产物在 dist/(dist 内无 manifest)、还有 src/。
  //    选「项目根」复制安装应自包含落地（这是用户遇到「添加失败」的精确场景）。
  const mkUserLayout = (name) => {
    const r = path.join(os.tmpdir(), 'ttool-plugin-smoke-' + name)
    fs.rmSync(r, { recursive: true, force: true })
    fs.mkdirSync(path.join(r, 'dist'), { recursive: true })
    fs.mkdirSync(path.join(r, 'src'), { recursive: true })
    fs.mkdirSync(path.join(r, 'node_modules', 'junk'), { recursive: true })
    fs.copyFileSync(path.join(HELLO_DIST, 'tool.js'), path.join(r, 'dist', 'tool.js'))
    fs.writeFileSync(path.join(r, 'src', 'index.tsx'), '// source')
    fs.writeFileSync(path.join(r, 'manifest.json'), JSON.stringify({ id: name, name: name, glyph: 'u', cat: '插件', hue: 'teal', version: '1', entry: 'tool.js', sdk: '1' }))
    return r
  }
  {
    const r = mkUserLayout('rootcopy')
    nextDir = r
    const res = await invoke('plugins:installLocal')
    const tj = path.join(USER_DATA, 'plugins', 'rootcopy', 'tool.js')
    const mj = path.join(USER_DATA, 'plugins', 'rootcopy', 'manifest.json')
    check('选项目根(复制) 入口+manifest 自包含落地', res && !res.error && fs.existsSync(tj) && fs.existsSync(mj))
    check('选项目根(复制) 未复制 node_modules', !fs.existsSync(path.join(USER_DATA, 'plugins', 'rootcopy', 'node_modules')))
    const b = await invoke('plugins:readBundle', { id: 'rootcopy' })
    check('选项目根(复制) readBundle 成功', typeof b === 'string' && b.length > 50)
  }

  // 10) 真实用户布局 + 开发者链接：选「项目根」→ manifest 从根读、bundle 从 dist/ 读，且实时
  {
    const r = mkUserLayout('rootlink')
    nextDir = r
    const res = await invoke('plugins:installLocalLink')
    check('选项目根(链接) 成功', res && !res.error && res.id === 'rootlink')
    const b = await invoke('plugins:readBundle', { id: 'rootlink' })
    check('选项目根(链接) readBundle 从 dist 取到', typeof b === 'string' && b.length > 50)
    // 实时：改 dist/tool.js 立即反映
    const tf = path.join(r, 'dist', 'tool.js')
    fs.writeFileSync(tf, fs.readFileSync(tf, 'utf8') + '\n/*ROOTLINK-LIVE*/')
    const b2 = await invoke('plugins:readBundle', { id: 'rootlink' })
    check('选项目根(链接) 实时反映 dist 改动', b2.includes('ROOTLINK-LIVE'))
    const lst = await invoke('plugins:list')
    check('选项目根(链接) list 含该插件', lst.some((p) => p.manifest.id === 'rootlink'))
  }

  // 11) 用户的精确失败场景：选「dist 子目录」(dist 内只有 bundle、manifest 在父级项目根) —— 向上回退
  {
    const r = mkUserLayout('selectdist')
    nextDir = path.join(r, 'dist') // 用户选的是 dist，不是根
    const res = await invoke('plugins:installLocalLink')
    check('选 dist(manifest 在父级) 链接成功', res && !res.error && res.id === 'selectdist')
    const b = await invoke('plugins:readBundle', { id: 'selectdist' })
    check('选 dist 链接 readBundle 成功', typeof b === 'string' && b.length > 50)
    // 复制安装同样：选 dist 也成功且自包含落地
    const r2 = mkUserLayout('selectdist2')
    nextDir = path.join(r2, 'dist')
    const res2 = await invoke('plugins:installLocal')
    check('选 dist(manifest 在父级) 复制成功+自包含', res2 && !res2.error && fs.existsSync(path.join(USER_DATA, 'plugins', 'selectdist2', 'manifest.json')) && fs.existsSync(path.join(USER_DATA, 'plugins', 'selectdist2', 'tool.js')))
  }

  console.log(pass ? 'PLUGIN SMOKE PASS' : 'PLUGIN SMOKE FAIL')
  process.exit(pass ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
