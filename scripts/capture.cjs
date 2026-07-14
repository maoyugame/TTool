// 用 Electron 自身 Chromium 渲染生产构建并 capturePage()，进程内截图（AV 安全）。
// 加载 preload + 提供 translate IPC，使其等价于真实桌面端的 electron 路径，
// 从而能真实验证翻译（renderer → IPC → 主进程 fetch → MyMemory）。
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { setupPlugins } = require('../electron/plugins.cjs')
const { setupUpdater } = require('../electron/updater.cjs')

app.setName('ttool')

const VIEW = process.env.CAPTURE_VIEW || 'home'

// 翻译 IPC（镜像 main.cjs）
const TR_LANG = { zh: 'zh-CN', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr' }
ipcMain.handle('translate', async (_e, { text, from, to }) => {
  const pair = (TR_LANG[from] || from) + '|' + (TR_LANG[to] || to)
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(String(text)) + '&langpair=' + pair
  const res = await fetch(url)
  const data = await res.json()
  if (data && data.responseStatus === 200 && data.responseData) return data.responseData.translatedText
  throw new Error((data && data.responseDetails) || '翻译失败')
})
ipcMain.handle('clipboard:write', () => true)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const run = (win, js) => win.webContents.executeJavaScript(js).catch(() => null)

async function scenario(win) {
  if (VIEW === 'home') {
    await wait(1800)
    return
  }
  if (VIEW === 'search') {
    await wait(1200)
    await run(win, `(() => {
      const input = document.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'fanyi'); input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await wait(900)
    return
  }
  if (VIEW === 'apps') {
    await wait(1200)
    await run(win, `(() => { const el=[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='应用'); if(el) el.click(); })()`)
    await wait(1200)
    return
  }
  if (VIEW === 'apps-seeded') {
    await wait(800)
    await run(win, `localStorage.setItem('ttool.apps', JSON.stringify([{id:'a1',name:'Visual Studio Code',path:'C:/Program Files/VS Code/Code.exe'},{id:'a2',name:'记事本',path:'C:/Windows/notepad.exe'},{id:'a3',name:'Figma',path:'C:/Apps/Figma.exe'}]))`)
    await run(win, `location.reload()`)
    await wait(1600)
    await run(win, `(() => { const el=[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='应用'); if(el) el.click(); })()`)
    await wait(1200)
    return
  }
  if (VIEW === 'hello') {
    let r = 'notfound'
    for (let i = 0; i < 25; i++) {
      r = await run(win, `(() => { const t=[...document.querySelectorAll('div')].find(d=>d.textContent.trim()==='Hello 插件' && d.childElementCount===0); if(!t) return 'notfound'; t.parentElement.parentElement.click(); return 'clicked'; })()`)
      if (r === 'clicked') break
      await wait(300)
    }
    console.log('HELLO CLICK: ' + r)
    await wait(3000) // 等懒加载 bundle + 渲染
    return
  }
  if (VIEW === 'extensions') {
    await wait(3000)
    const r = await run(win, `(() => { const b=document.querySelector('[title="扩展 · 工具插件"]'); if(!b) return 'nobtn'; b.click(); return 'clicked'; })()`)
    console.log('EXT CLICK: ' + r)
    await wait(2000)
    return
  }
  if (VIEW === 'settings') {
    await wait(1200)
    const r1 = await run(win, `(() => { const el = document.querySelector('[title="设置"]'); if (!el) return 'no-button'; el.click(); return 'clicked'; })()`)
    await wait(2500)
    const r2 = await run(win, `(() => {
      const all=[...document.querySelectorAll('div')];
      const ov=all.find(d=>{const s=getComputedStyle(d); return s.position==='absolute' && parseInt(s.zIndex)>=50 && d.textContent.includes('运行环境');});
      if(!ov) return 'overlay-not-found';
      const r=ov.getBoundingClientRect(); const cs=getComputedStyle(ov);
      return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),opacity:cs.opacity,display:cs.display,visibility:cs.visibility,z:cs.zIndex});
    })()`)
    console.log('SETTINGS PROBE: ' + r1 + ' / ' + r2)
    return
  }
  if (VIEW === 'translate') {
    await wait(1200)
    // 打开即时翻译工具
    await run(win, `(() => {
      const t = [...document.querySelectorAll('div')].find(d => d.textContent.trim() === '即时翻译' && d.childElementCount === 0);
      if (t) t.parentElement.parentElement.click();
    })()`)
    await wait(1000)
    // 点击「翻译」按钮触发真实 API
    await run(win, `(() => {
      const b = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === '翻译');
      if (b) b.click();
    })()`)
    await wait(5000) // 等 MyMemory 返回
    return
  }
  await wait(1800)
}

app.whenReady().then(async () => {
  setupPlugins({ ipcMain, app, dialog, getWin: () => win })
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    show: process.env.CAP_SHOW === '1',
    backgroundColor: '#0d0e14',
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  const updaterHost = setupUpdater({
    app,
    ipcMain,
    dialog,
    getWin: () => win,
    markQuitting: () => {},
    autoCheck: false,
  })
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await scenario(win)
  const img = await win.webContents.capturePage()
  const dir = path.join(__dirname, '..', '.verify')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, 'cap-' + VIEW + '.jpg')
  fs.writeFileSync(out, img.toJPEG(82))
  console.log('CAPTURED ' + out + ' (' + fs.statSync(out).size + ' bytes)')
  updaterHost.dispose()
  app.quit()
})
