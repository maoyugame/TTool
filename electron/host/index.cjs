// 宿主能力编排：连接 envelope（registry）+ net + storage + secrets。
// db 适配器（mysql/redis/mongo）后续复用同一 registry，在此追加 setupXxx。
//
// setupHost 在 app.whenReady 后调用一次；返回：
//   - closeAll()      退出时回收全部连接并清计时器（app.will-quit）
//   - bindWindow(win) 为窗口绑定 owner 清理（destroyed / 渲染崩溃 / 整页重载时回收连接）
const { createRegistry } = require('./registry.cjs')
const { setupNet } = require('./net.cjs')
const { setupStorage } = require('./storage.cjs')
const { setupSecrets } = require('./secrets.cjs')

function setupHost({ ipcMain, app, getWin }) {
  const registry = createRegistry({ maxPerPlugin: 16, maxTotal: 64, idleMs: 30 * 60 * 1000 })

  setupNet({
    ipcMain,
    registry,
    getSender: () => {
      const w = getWin && getWin()
      return w && !w.isDestroyed() ? w.webContents : null
    },
  })
  setupStorage({ ipcMain, app })
  setupSecrets({ ipcMain, app })

  // DB 适配器：复用同一 registry（连接预占 / 忙碌 / owner 清理 / 上限）。
  // 某驱动 require 失败则跳过其挂载，其余正常。
  for (const [name, mod] of [['mysql', './mysql.cjs'], ['redis', './redis.cjs'], ['mongo', './mongo.cjs']]) {
    try {
      const setup = require(mod)[`setup${name[0].toUpperCase()}${name.slice(1)}`]
      setup({ ipcMain, registry })
    } catch (err) {
      console.warn(`[ttool] DB 适配器 ${name} 未挂载：`, err && err.message ? err.message : err)
    }
  }

  const bound = new WeakSet()
  function bindWindow(win) {
    if (!win || bound.has(win)) return
    bound.add(win)
    const wc = win.webContents
    const clear = () => registry.closeConnections()
    wc.on('destroyed', clear)
    wc.on('render-process-gone', clear) // 渲染进程崩溃：秒级回收，而非等 idle TTL
    wc.on('did-start-navigation', (details) => {
      // 用 details 对象（非已弃用的位置参数），跨 Electron 版本稳定。
      // 仅整页重载 / 真实主框架导航才回收；同文档导航（hash / history.pushState / 锚点）忽略，
      // 否则单页应用切个内部 tab 就会误杀活跃连接（REV-15）。
      if (details && details.isMainFrame && !details.isSameDocument) clear()
    })
  }

  return { closeAll: () => registry.closeAll(), bindWindow }
}

module.exports = { setupHost }
