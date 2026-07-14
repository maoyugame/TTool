const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { sanitizeError, setupUpdater } = require('../electron/updater.cjs')

class FakeUpdater extends EventEmitter {
  constructor() {
    super()
    this.checkCalls = 0
    this.downloadCalls = 0
    this.installCalls = 0
  }

  async checkForUpdates() {
    this.checkCalls += 1
    this.emit('checking-for-update')
    this.emit('update-available', {
      version: '0.2.1',
      releaseName: 'TTool 0.2.1',
      releaseNotes: '<b>修复</b>\n稳定性提升',
      releaseDate: '2026-07-14T00:00:00.000Z',
    })
  }

  async downloadUpdate() {
    this.downloadCalls += 1
    this.emit('download-progress', { percent: 42.5, transferred: 425, total: 1000, bytesPerSecond: 50 })
    this.emit('update-downloaded', { version: '0.2.1' })
  }

  quitAndInstall() {
    this.installCalls += 1
  }
}

function createIpc() {
  const handlers = new Map()
  return {
    handlers,
    handle(channel, handler) { handlers.set(channel, handler) },
    removeHandler(channel) { handlers.delete(channel) },
  }
}

function createWindow() {
  const sent = []
  const mainFrame = {}
  const webContents = { mainFrame, send: (channel, state) => sent.push([channel, state]) }
  return { sent, webContents, isDestroyed: () => false }
}

async function main() {
  const app = new EventEmitter()
  app.isPackaged = true
  app.getVersion = () => '0.2.0'
  const ipcMain = createIpc()
  const win = createWindow()
  const updater = new FakeUpdater()
  let quitting = false
  let resolveInstallDialog = null
  const controller = setupUpdater({
    app,
    ipcMain,
    dialog: {
      showMessageBox: () => new Promise((resolve) => { resolveInstallDialog = resolve }),
    },
    getWin: () => win,
    markQuitting: () => { quitting = true },
    updater,
    platform: 'win32',
    autoCheck: false,
  })
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }

  assert.equal((await ipcMain.handlers.get('updates:getState')(event)).status, 'idle')
  assert.deepEqual(await ipcMain.handlers.get('updates:check')(event), { ok: true })
  assert.equal(controller.getState().status, 'available')
  assert.equal(controller.getState().availableVersion, '0.2.1')
  assert.equal(updater.checkCalls, 1)

  assert.deepEqual(await ipcMain.handlers.get('updates:download')(event), { ok: true })
  assert.equal(controller.getState().status, 'downloaded')
  assert.equal(controller.getState().progress.percent, 100)
  assert.equal(updater.downloadCalls, 1)

  const installPromise = ipcMain.handlers.get('updates:install')(event)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(await ipcMain.handlers.get('updates:install')(event), { ok: false, error: '更新任务正在执行：install' })
  resolveInstallDialog({ response: 1 })
  assert.deepEqual(await installPromise, { ok: true })
  assert.equal(quitting, true)
  assert.equal(updater.installCalls, 1)

  const unauthorized = await ipcMain.handlers.get('updates:check')({ sender: {}, senderFrame: {} })
  assert.deepEqual(unauthorized, { ok: false, error: 'UNAUTHORIZED' })
  const sanitized = sanitizeError(new Error('Authorization: secret https://example.test/latest.yml?token=secret'))
  assert.equal(sanitized.includes('secret'), false)
  assert.equal(sanitized.includes('example.test'), false)
  assert.equal(sanitizeError(new Error('TTOOL_UPDATE_GH_TOKEN=machine-secret')).includes('machine-secret'), false)
  assert.ok(win.sent.length >= 4)
  controller.dispose()
  assert.equal(ipcMain.handlers.size, 0)

  const devApp = new EventEmitter()
  devApp.isPackaged = false
  devApp.getVersion = () => '0.2.0'
  const devIpc = createIpc()
  const devWin = createWindow()
  const devController = setupUpdater({
    app: devApp,
    ipcMain: devIpc,
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    getWin: () => devWin,
    markQuitting: () => {},
    platform: 'win32',
    autoCheck: false,
  })
  const devEvent = { sender: devWin.webContents, senderFrame: devWin.webContents.mainFrame }
  assert.equal((await devIpc.handlers.get('updates:getState')(devEvent)).status, 'disabled')
  assert.equal((await devIpc.handlers.get('updates:check')(devEvent)).ok, false)
  devController.dispose()

  console.log('UPDATER OK: state machine, authorization, download, exclusive install confirmation and dev fallback passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
