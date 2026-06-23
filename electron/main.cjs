// Electron 主进程：创建无边框毛玻璃窗口，并通过 IPC 暴露桌面能力
// （剪贴板、打开第三方应用、选择应用路径、窗口控制）。
// 设计为可选壳层——核心 React 应用在浏览器中也能独立运行（见 src/platform）。
const { app, BrowserWindow, ipcMain, clipboard, shell, dialog, globalShortcut, screen } = require('electron')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { setupPlugins } = require('./plugins.cjs')
const { setupHost } = require('./host/index.cjs')
const { searchFiles } = require('./filesearch.cjs')

// 固定应用名，确保 userData（插件目录）路径稳定一致（dev 下默认会变成 "Electron"）。
app.setName('ttool')

const DEV_URL = process.env.TOOLBOX_DEV_URL
let win = null
let host = null // 宿主能力（net / storage / secrets），whenReady 后初始化
let launcher = null // 快速启动器小窗（Spotlight 式悬浮窗）
const LAUNCHER_W = 720
let launcherHeight = 72 // 渲染层按内容动态上报；初始仅搜索栏高度

// 翻译（主进程 fetch，免 CORS）。与 src/platform/translateApi.ts 逻辑保持一致。
const TR_LANG = { zh: 'zh-CN', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr' }
async function translateText(text, from, to) {
  const pair = (TR_LANG[from] || from) + '|' + (TR_LANG[to] || to)
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + pair
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error('翻译服务返回 ' + res.status)
    const data = await res.json()
    if (data && data.responseStatus === 200 && data.responseData && typeof data.responseData.translatedText === 'string') {
      return data.responseData.translatedText
    }
    throw new Error((data && data.responseDetails) || '翻译失败')
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('翻译超时，请检查网络')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// 纵深防御（两个窗口共用）：禁止页面/插件开新窗口或把应用导航离开（外链交系统浏览器）。
function hardenWebContents(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (e) => e.preventDefault())
}

function createWindow() {
  // 各平台的"毛玻璃 / 半透明"窗口质感。
  const vibrancyOpts =
    process.platform === 'darwin'
      ? { vibrancy: 'under-window', visualEffectState: 'active' }
      : process.platform === 'win32'
      ? { backgroundMaterial: 'acrylic' }
      : {}

  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 880,
    minHeight: 560,
    frame: false, // 自定义标题栏
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#00000000',
    transparent: process.platform === 'darwin',
    show: false,
    ...vibrancyOpts,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // 保持默认沙箱开启：preload 仅用 contextBridge + ipcRenderer（沙箱化下由 Electron 提供），
      // 无需 Node 内置模块；主进程能力（spawn 等）不受渲染进程沙箱影响。
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // 纵深防御：禁止插件/页面打开新窗口或把应用导航离开（外链交由系统浏览器）
  hardenWebContents(win.webContents)

  // 窗口获得焦点 → 通知渲染层（用于自动聚焦搜索框）
  win.on('focus', () => win.webContents.send('ttool:window-focus'))

  // 调试快捷键（无菜单的无边框窗口默认不响应，故显式处理）：
  //   F12 / Ctrl(⌘)+Shift+I → 开/关开发者工具（看插件 console 错误）
  //   Ctrl(⌘)+R / F5         → 重载窗口（开发者链接插件改代码重新构建后，重载即生效）
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const mod = process.platform === 'darwin' ? input.meta : input.control
    const key = (input.key || '').toLowerCase()
    if (key === 'f12' || (mod && input.shift && key === 'i')) {
      win.webContents.toggleDevTools()
      e.preventDefault()
    } else if ((mod && key === 'r') || key === 'f5') {
      win.webContents.reload()
      e.preventDefault()
    }
  })

  // 绑定宿主能力的 owner 清理（窗口销毁 / 渲染崩溃 / 整页重载时回收连接）
  if (host) host.bindWindow(win)

  if (DEV_URL) {
    win.loadURL(DEV_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.on('closed', () => {
    win = null
    // 主窗关闭后销毁常驻的启动器小窗，确保 window-all-closed 能触发应用退出（非 mac）
    if (launcher && !launcher.isDestroyed()) launcher.destroy()
  })
}

// ---- IPC：桌面能力 ----
ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text ?? ''))
  return true
})

// 打开第三方应用：优先用 shell 打开路径；失败再尝试 spawn 可执行文件。
ipcMain.handle('app:open', async (_e, targetPath) => {
  const p = String(targetPath ?? '').trim()
  if (!p) return { ok: false, error: '路径为空' }
  try {
    const err = await shell.openPath(p)
    if (!err) return { ok: true }
    // openPath 对纯可执行文件可能返回错误，回退到 spawn。
    const child = spawn(p, [], { detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) }
  }
})

// 选择本地应用路径。
ipcMain.handle('dialog:pickApp', async () => {
  const filters =
    process.platform === 'darwin'
      ? [{ name: '应用', extensions: ['app'] }]
      : process.platform === 'win32'
      ? [{ name: '可执行文件', extensions: ['exe', 'lnk', 'bat', 'cmd'] }]
      : [{ name: '全部文件', extensions: ['*'] }]
  const res = await dialog.showOpenDialog(win, {
    title: '选择应用',
    properties: ['openFile'],
    filters,
  })
  if (res.canceled || !res.filePaths.length) return { canceled: true }
  return { canceled: false, path: res.filePaths[0] }
})

ipcMain.handle('translate', async (_e, { text, from, to }) => {
  return translateText(String(text ?? ''), from, to)
})

// ---- 快速启动器小窗（Spotlight 式）：无边框 / 透明 / 置顶 / 不占任务栏 / 动态高度 ----
const LAUNCHER_INIT_H = 72 // 仅搜索栏的初始高度
let launcherReady = false // 渲染层是否已加载完（可安全收到 ttool:summon）
function createLauncher() {
  launcher = new BrowserWindow({
    width: LAUNCHER_W,
    height: launcherHeight,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  launcher.setAlwaysOnTop(true, 'screen-saver')
  hardenWebContents(launcher.webContents) // 与主窗一致的导航/开窗防护
  launcherReady = false
  launcher.webContents.once('did-finish-load', () => {
    launcherReady = true
  })
  if (DEV_URL) launcher.loadURL(DEV_URL + '#launcher')
  else launcher.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'launcher' })
  // 失焦即隐藏（点别处/切到别的应用），符合启动器直觉
  launcher.on('blur', () => {
    if (launcher && launcher.isVisible()) launcher.hide()
  })
  launcher.on('closed', () => {
    launcher = null
    launcherReady = false
  })
}

// 通知小窗渲染层重置查询/同步主题/聚焦；渲染层未就绪时等加载完再发，避免信号丢失
function sendLauncherSummon() {
  if (!launcher) return
  if (launcherReady) launcher.webContents.send('ttool:summon')
  else launcher.webContents.once('did-finish-load', () => launcher && launcher.webContents.send('ttool:summon'))
}

// 把小窗摆在当前鼠标所在屏幕的水平居中、偏上位置
function positionLauncher() {
  if (!launcher) return
  const cursor = screen.getCursorScreenPoint()
  const disp = screen.getDisplayNearestPoint(cursor)
  const wa = disp.workArea
  const x = Math.round(wa.x + (wa.width - LAUNCHER_W) / 2)
  const y = Math.round(wa.y + wa.height * 0.16)
  launcher.setBounds({ x, y, width: LAUNCHER_W, height: launcherHeight })
}

function toggleLauncher() {
  if (!launcher) createLauncher()
  if (launcher.isVisible()) {
    launcher.hide()
    return
  }
  launcherHeight = LAUNCHER_INIT_H // 先收回初始高度，避免残留上次的大高度先撑开再回缩的闪动
  positionLauncher()
  launcher.show()
  // Windows 前台锁定下普通 focus 可能抢不到键盘焦点：用 app.focus(steal) + moveTop 兜底
  try { app.focus({ steal: true }) } catch { /* ignore */ }
  launcher.moveTop()
  launcher.focus()
  sendLauncherSummon() // 通知渲染层重置查询并聚焦搜索框（就绪后才发）
}

// ---- IPC：快速启动器 ----
ipcMain.handle('launcher:hide', () => {
  if (launcher) launcher.hide()
  return true
})
// 渲染层按内容上报高度 → 调整小窗高度并保持顶部位置不变
ipcMain.handle('launcher:resize', (_e, { height }) => {
  const h = Math.max(64, Math.min(560, Math.round(Number(height) || 72)))
  launcherHeight = h
  if (launcher && launcher.isVisible()) {
    const b = launcher.getBounds()
    launcher.setBounds({ x: b.x, y: b.y, width: LAUNCHER_W, height: h })
  }
  return true
})
// 在小窗里选中工具 → 把主窗口带到前台并打开该工具，隐藏小窗
ipcMain.handle('launcher:openTool', (_e, { id }) => {
  if (!win) createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  const send = () => win && win.webContents.send('ttool:open-tool', String(id || ''))
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
  if (launcher) launcher.hide()
  return true
})

// ---- IPC：本机文件搜索 / 打开 ----
ipcMain.handle('files:search', async (_e, { query }) => {
  try {
    return await searchFiles(query)
  } catch {
    return []
  }
})
// 可执行扩展名：直接 openPath 会执行而非"用默认程序打开文档"，命中时弹窗二次确认
const EXEC_EXT = new Set(['.exe', '.com', '.bat', '.cmd', '.ps1', '.msi', '.scr', '.lnk', '.vbs', '.js', '.jar', '.reg', '.hta', '.cpl', '.wsf', '.pif', '.application'])
ipcMain.handle('files:open', async (_e, { path: p }) => {
  const fp = String(p || '')
  if (EXEC_EXT.has(path.extname(fp).toLowerCase())) {
    const { response } = await dialog.showMessageBox(win || undefined, {
      type: 'warning',
      buttons: ['取消', '仍要运行'],
      defaultId: 0,
      cancelId: 0,
      title: '运行可执行文件',
      message: '这是一个可执行文件，运行它可能有风险。确认运行？',
      detail: fp,
    })
    if (response !== 1) return { ok: false, error: '已取消' }
  }
  const err = await shell.openPath(fp)
  return { ok: !err, error: err || undefined }
})
ipcMain.handle('files:reveal', (_e, { path: p }) => {
  shell.showItemInFolder(String(p || ''))
  return true
})

// ---- IPC：窗口控制（自定义标题栏的红黄绿按钮） ----
ipcMain.handle('win:minimize', () => win && win.minimize())
ipcMain.handle('win:toggleMaximize', () => {
  if (!win) return
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.handle('win:close', () => win && win.close())

app.whenReady().then(() => {
  setupPlugins({ ipcMain, app, dialog, getWin: () => win })
  // 宿主能力：通用 net（TCP/TLS）+ 按插件命名空间的 storage + safeStorage 加密 secrets
  host = setupHost({ ipcMain, app, getWin: () => win })
  createWindow()
  createLauncher() // 预创建启动器小窗（隐藏），首次唤起即时
  // 注册全局热键切换快速启动器小窗：首选 Alt+Space，并叠加一个不易被输入法占用的备用键。
  // Alt+Space 常被输入法/其它软件抢占（注册时灵时不灵），故同时注册 Ctrl+Alt+Space 兜底。
  const HOTKEYS = ['Alt+Space', 'Control+Alt+Space']
  const registered = []
  for (const hk of HOTKEYS) {
    try {
      if (globalShortcut.register(hk, toggleLauncher)) registered.push(hk)
    } catch {
      /* ignore */
    }
  }
  if (registered.length) console.log('[ttool] 快速启动器全局热键已注册：' + registered.join('、'))
  else console.warn('[ttool] 全局热键全部注册失败（可能被其它程序占用），可在任务栏图标或主窗内唤起')
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (host) host.closeAll() // 回收全部 net 连接并停掉 idle 扫描
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
