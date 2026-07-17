// 进程内截图快速启动器小窗（加载 dist/index.html#launcher），验证紧凑卡片渲染 + 主题。
// 用 capturePage（AV 安全），输出 jpg，已压缩；可选 CAP_QUERY 注入查询、CAP_THEME 切主题。
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

app.setName('ttool')
const QUERY = process.env.CAP_QUERY || ''
const THEME = process.env.CAP_THEME || 'dark'
const EXPECT_APP = process.env.CAP_EXPECT_APP || ''
const EXPECT_APP_PATH = process.env.CAP_EXPECT_APP_PATH || ''
const ACTIVATE_APP = process.env.CAP_ACTIVATE_APP || ''
const TEST_USER_DATA = process.env.CAP_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'ttool-launcher-capture-'))
let openedAppPath = ''
let launcherWasHidden = false

function finish(exitCode) {
  app.exit(exitCode)
}

let apps = []
try {
  const parsed = JSON.parse(process.env.CAP_APPS || '[]')
  if (Array.isArray(parsed)) apps = parsed
} catch {
  /* Invalid test data intentionally behaves as an empty app list. */
}

app.setPath('userData', TEST_USER_DATA)

// 启动器会调用这些 IPC，桩掉避免报错
ipcMain.handle('launcher:hide', () => { launcherWasHidden = true; return true })
ipcMain.handle('launcher:resize', () => true)
ipcMain.handle('launcher:openTool', () => true)
ipcMain.handle('files:search', () => [])
ipcMain.handle('files:open', () => ({ ok: true }))
ipcMain.handle('files:reveal', () => true)
ipcMain.handle('plugins:list', () => [])
ipcMain.handle('app:open', (_event, targetPath) => { openedAppPath = String(targetPath || ''); return { ok: true } })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 720,
    height: 460,
    show: process.env.CAP_SHOW === '1',
    backgroundColor: '#1b1d27',
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'launcher' })
  const seed = JSON.stringify({ theme: THEME, recents: ['translate', 'json', 'timestamp'], apps })
  await win.webContents.executeJavaScript(`try{const seed=${seed};localStorage.setItem('ttool.theme',seed.theme);localStorage.setItem('ttool.recents',JSON.stringify(seed.recents));localStorage.setItem('ttool.apps',JSON.stringify(seed.apps))}catch(e){}`)
  await win.webContents.reload()
  await wait(900)
  if (QUERY) {
    await win.webContents.executeJavaScript(`(()=>{const i=document.querySelector('input');if(!i)return;const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'${QUERY}');i.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await wait(700)
  }
  if (EXPECT_APP) {
    const matched = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-item-kind="app"]')).some((row) => row.dataset.itemName === ${JSON.stringify(EXPECT_APP)})`)
    if (!matched) throw new Error(`Expected manual app was not rendered: ${EXPECT_APP}`)
  }
  if (ACTIVATE_APP) {
    const activated = await win.webContents.executeJavaScript(`(() => { const row = Array.from(document.querySelectorAll('[data-item-kind="app"]')).find((item) => item.dataset.itemName === ${JSON.stringify(ACTIVATE_APP)}); if (!row) return false; row.click(); return true })()`)
    if (!activated) throw new Error(`Manual app could not be activated: ${ACTIVATE_APP}`)
    await wait(120)
    if (!launcherWasHidden) throw new Error('Manual app activation did not hide the launcher')
    if (EXPECT_APP_PATH && openedAppPath !== EXPECT_APP_PATH) throw new Error(`Manual app activation used an unexpected path: ${openedAppPath}`)
  }
  const img = await win.webContents.capturePage()
  const dir = path.join(__dirname, '..', '.verify')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, 'launcher-' + THEME + (QUERY ? '-q' : '') + '.jpg')
  fs.writeFileSync(out, img.toJPEG(80))
  console.log('CAPTURED ' + out + ' (' + fs.statSync(out).size + ' bytes)')
  finish(0)
}).catch((error) => {
  console.error(error)
  finish(1)
})
