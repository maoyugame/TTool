// TTool 宿主自动更新：更新器只运行在主进程，渲染层通过受控 IPC 读取状态和触发用户动作。
// 当前仅启用 Windows NSIS 安装版；开发态和其它平台明确降级为 unsupported/disabled。
const UPDATE_STATE_EVENT = 'ttool:update-state'
const STARTUP_CHECK_DELAY_MS = 15_000
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0))
}

function normalizeReleaseNotes(value) {
  if (typeof value === 'string') return value.slice(0, 12_000)
  if (!Array.isArray(value)) return null
  const text = value
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const version = typeof item.version === 'string' ? item.version.trim() : ''
      const note = typeof item.note === 'string' ? item.note.trim() : ''
      return [version && `v${version}`, note].filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
  return text ? text.slice(0, 12_000) : null
}

function sanitizeError(error) {
  const raw = error && error.message ? String(error.message) : String(error || '更新失败')
  return raw
    .replace(/https?:\/\/[^\s"']+/gi, '[update-endpoint]')
    .replace(/(token|authorization|bearer|gh_token|ttool_update_gh_token)\s*[:=]?\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 600)
}

function createInitialState({ version, platform, packaged }) {
  const supported = platform === 'win32'
  return {
    status: supported ? (packaged ? 'idle' : 'disabled') : 'unsupported',
    supported,
    enabled: supported && packaged,
    currentVersion: version,
    availableVersion: null,
    releaseName: null,
    releaseNotes: null,
    releaseDate: null,
    progress: null,
    checkedAt: null,
    error: null,
  }
}

function setupUpdater({
  app,
  ipcMain,
  dialog,
  getWin,
  markQuitting,
  updater: injectedUpdater,
  platform = process.platform,
  autoCheck = true,
  startupDelayMs = STARTUP_CHECK_DELAY_MS,
  periodicIntervalMs = PERIODIC_CHECK_INTERVAL_MS,
}) {
  const state = createInitialState({
    version: app.getVersion(),
    platform,
    packaged: Boolean(app.isPackaged),
  })
  // electron-updater 的私有 GitHub Provider 固定读取 GH_TOKEN。允许终端机器使用
  // TTool 专用变量，避免只读更新 token 覆盖同机 GitHub CLI 的登录凭证。
  if (!process.env.GH_TOKEN && process.env.TTOOL_UPDATE_GH_TOKEN) {
    process.env.GH_TOKEN = process.env.TTOOL_UPDATE_GH_TOKEN
  }
  const updater = injectedUpdater || (state.enabled ? require('electron-updater').autoUpdater : null)
  const listeners = []
  let startupTimer = null
  let periodicTimer = null
  let busy = null

  const publicState = () => ({ ...state, progress: state.progress ? { ...state.progress } : null })

  const emitState = (patch) => {
    Object.assign(state, patch)
    const target = getWin()
    if (target && !target.isDestroyed()) target.webContents.send(UPDATE_STATE_EVENT, publicState())
  }

  const isAuthorizedMainFrame = (event) => {
    const target = getWin()
    if (!target || target.isDestroyed() || event.sender !== target.webContents) return false
    return !event.senderFrame || !target.webContents.mainFrame || event.senderFrame === target.webContents.mainFrame
  }

  const commandResult = (ok, error) => ({ ok, ...(error ? { error } : {}) })

  const ensureCommandAllowed = (event) => {
    if (!isAuthorizedMainFrame(event)) return commandResult(false, 'UNAUTHORIZED')
    if (!state.enabled || !updater) {
      const error = state.supported ? '自动更新仅在已安装的 Windows 版本中启用' : '当前平台暂不支持自动更新'
      return commandResult(false, error)
    }
    return null
  }

  const runExclusive = async (name, action) => {
    if (busy) return commandResult(false, `更新任务正在执行：${busy}`)
    busy = name
    try {
      await action()
      return commandResult(true)
    } catch (error) {
      const message = sanitizeError(error)
      emitState({ status: 'error', error: message, progress: null })
      return commandResult(false, message)
    } finally {
      busy = null
    }
  }

  const check = async () => runExclusive('check', async () => {
    emitState({ status: 'checking', error: null, progress: null })
    await updater.checkForUpdates()
  })

  const download = async () => {
    if (state.status !== 'available') return commandResult(false, '当前没有可下载的更新')
    return runExclusive('download', async () => {
      emitState({
        status: 'downloading',
        error: null,
        progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
      })
      await updater.downloadUpdate()
    })
  }

  const install = async () => {
    if (state.status !== 'downloaded') return commandResult(false, '更新尚未下载完成')
    if (busy) return commandResult(false, `更新任务正在执行：${busy}`)
    busy = 'install'
    try {
      const target = getWin()
      const result = await dialog.showMessageBox(target && !target.isDestroyed() ? target : undefined, {
        type: 'info',
        title: '重启并更新 TTool',
        message: `已准备好更新到 v${state.availableVersion || '新版本'}`,
        detail: 'TTool 将退出并完成安装，然后自动重新启动。',
        buttons: ['稍后', '重启并更新'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      })
      if (result.response !== 1) return commandResult(false, 'CANCELED')
      markQuitting()
      emitState({ status: 'installing', error: null })
      updater.quitAndInstall(false, true)
      return commandResult(true)
    } catch (error) {
      const message = sanitizeError(error)
      emitState({ status: 'error', error: message, progress: null })
      return commandResult(false, message)
    } finally {
      busy = null
    }
  }

  ipcMain.handle('updates:getState', (event) => {
    if (!isAuthorizedMainFrame(event)) throw new Error('UNAUTHORIZED')
    return publicState()
  })
  ipcMain.handle('updates:check', async (event) => {
    const denied = ensureCommandAllowed(event)
    return denied || check()
  })
  ipcMain.handle('updates:download', async (event) => {
    const denied = ensureCommandAllowed(event)
    return denied || download()
  })
  ipcMain.handle('updates:install', async (event) => {
    const denied = ensureCommandAllowed(event)
    return denied || install()
  })

  if (updater) {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.autoRunAppAfterInstall = true
    updater.allowPrerelease = false
    updater.disableWebInstaller = true
    updater.logger = null

    const on = (event, handler) => {
      updater.on(event, handler)
      listeners.push([event, handler])
    }
    on('checking-for-update', () => emitState({ status: 'checking', error: null }))
    on('update-available', (info = {}) => emitState({
      status: 'available',
      availableVersion: typeof info.version === 'string' ? info.version : null,
      releaseName: typeof info.releaseName === 'string' ? info.releaseName : null,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : null,
      checkedAt: new Date().toISOString(),
      progress: null,
      error: null,
    }))
    on('update-not-available', () => emitState({
      status: 'up-to-date',
      availableVersion: null,
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      checkedAt: new Date().toISOString(),
      progress: null,
      error: null,
    }))
    on('download-progress', (progress = {}) => emitState({
      status: 'downloading',
      progress: {
        percent: clamp(progress.percent, 0, 100),
        transferred: Math.max(0, Number(progress.transferred) || 0),
        total: Math.max(0, Number(progress.total) || 0),
        bytesPerSecond: Math.max(0, Number(progress.bytesPerSecond) || 0),
      },
      error: null,
    }))
    on('update-downloaded', (info = {}) => emitState({
      status: 'downloaded',
      availableVersion: typeof info.version === 'string' ? info.version : state.availableVersion,
      releaseName: typeof info.releaseName === 'string' ? info.releaseName : state.releaseName,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes) || state.releaseNotes,
      releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : state.releaseDate,
      progress: state.progress ? { ...state.progress, percent: 100 } : null,
      error: null,
    }))
    on('error', (error) => emitState({ status: 'error', error: sanitizeError(error), progress: null }))

    if (typeof app.on === 'function') {
      app.on('before-quit-for-update', markQuitting)
      listeners.push(['app:before-quit-for-update', markQuitting])
    }

    if (autoCheck) {
      const automaticCheck = () => {
        if (busy || ['downloading', 'downloaded', 'installing'].includes(state.status)) return
        void check()
      }
      startupTimer = setTimeout(automaticCheck, startupDelayMs)
      if (typeof startupTimer.unref === 'function') startupTimer.unref()
      periodicTimer = setInterval(automaticCheck, periodicIntervalMs)
      if (typeof periodicTimer.unref === 'function') periodicTimer.unref()
    }
  }

  return {
    getState: publicState,
    dispose() {
      if (startupTimer) clearTimeout(startupTimer)
      if (periodicTimer) clearInterval(periodicTimer)
      for (const [event, handler] of listeners) {
        if (event === 'app:before-quit-for-update') app.removeListener('before-quit-for-update', handler)
        else updater.removeListener(event, handler)
      }
      ipcMain.removeHandler('updates:getState')
      ipcMain.removeHandler('updates:check')
      ipcMain.removeHandler('updates:download')
      ipcMain.removeHandler('updates:install')
    },
  }
}

module.exports = {
  UPDATE_STATE_EVENT,
  createInitialState,
  normalizeReleaseNotes,
  sanitizeError,
  setupUpdater,
}
