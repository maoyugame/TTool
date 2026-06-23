// 进程内截图快速启动器小窗（加载 dist/index.html#launcher），验证紧凑卡片渲染 + 主题。
// 用 capturePage（AV 安全），输出 jpg，已压缩；可选 CAP_QUERY 注入查询、CAP_THEME 切主题。
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

app.setName('ttool')
const QUERY = process.env.CAP_QUERY || ''
const THEME = process.env.CAP_THEME || 'dark'

// 启动器会调用这些 IPC，桩掉避免报错
ipcMain.handle('launcher:hide', () => true)
ipcMain.handle('launcher:resize', () => true)
ipcMain.handle('launcher:openTool', () => true)
ipcMain.handle('files:search', () => [])
ipcMain.handle('files:open', () => ({ ok: true }))
ipcMain.handle('files:reveal', () => true)
ipcMain.handle('plugins:list', () => [])

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
  await win.webContents.executeJavaScript(`try{localStorage.setItem('ttool.theme','${THEME}');localStorage.setItem('ttool.recents',JSON.stringify(['translate','json','timestamp']))}catch(e){}`)
  await win.webContents.reload()
  await wait(900)
  if (QUERY) {
    await win.webContents.executeJavaScript(`(()=>{const i=document.querySelector('input');if(!i)return;const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'${QUERY}');i.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await wait(700)
  }
  const img = await win.webContents.capturePage()
  const dir = path.join(__dirname, '..', '.verify')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, 'launcher-' + THEME + (QUERY ? '-q' : '') + '.jpg')
  fs.writeFileSync(out, img.toJPEG(80))
  console.log('CAPTURED ' + out + ' (' + fs.statSync(out).size + ' bytes)')
  app.quit()
})
