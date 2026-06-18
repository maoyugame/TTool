// Electron 主进程：创建无边框毛玻璃窗口，并通过 IPC 暴露桌面能力
// （剪贴板、打开第三方应用、选择应用路径、窗口控制）。
// 设计为可选壳层——核心 React 应用在浏览器中也能独立运行（见 src/platform）。
const { app, BrowserWindow, ipcMain, clipboard, shell, dialog, globalShortcut } = require('electron')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { setupPlugins } = require('./plugins.cjs')

// 固定应用名，确保 userData（插件目录）路径稳定一致（dev 下默认会变成 "Electron"）。
app.setName('ttool')

const DEV_URL = process.env.TOOLBOX_DEV_URL
let win = null

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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  // 窗口获得焦点 → 通知渲染层（用于自动聚焦搜索框）
  win.on('focus', () => win.webContents.send('ttool:window-focus'))

  if (DEV_URL) {
    win.loadURL(DEV_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.on('closed', () => {
    win = null
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

// 全局唤醒：把窗口带到前台并通知渲染层聚焦搜索框 + 回到启动台
function summon() {
  if (!win) {
    createWindow()
    // 新建窗口需等渲染层加载并订阅后再补发唤醒信号
    win.webContents.once('did-finish-load', () => {
      if (win) win.webContents.send('ttool:summon')
    })
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('ttool:summon')
}

// ---- IPC：窗口控制（自定义标题栏的红黄绿按钮） ----
ipcMain.handle('win:minimize', () => win && win.minimize())
ipcMain.handle('win:toggleMaximize', () => {
  if (!win) return
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.handle('win:close', () => win && win.close())

app.whenReady().then(() => {
  setupPlugins({ ipcMain, app, dialog, getWin: () => win })
  createWindow()
  // 注册全局唤醒热键 Alt+Space
  const ok = globalShortcut.register('Alt+Space', summon)
  if (!ok) console.warn('[ttool] 全局热键 Alt+Space 注册失败（可能被其它程序占用）')
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
