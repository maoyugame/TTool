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

  // 2) 选错文件夹(项目根，manifest 在根但产物在 dist/)：应给出明确错误而非 ENOENT
  const PROJ_ROOT = path.resolve(__dirname, '..', 'examples', 'hello-tool')
  nextDir = PROJ_ROOT
  const wrong = await invoke('plugins:installLocal')
  check('选项目根 → 明确错误(提示 dist)', wrong && wrong.error && /dist/.test(wrong.error))

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

  console.log(pass ? 'PLUGIN SMOKE PASS' : 'PLUGIN SMOKE FAIL')
  process.exit(pass ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
