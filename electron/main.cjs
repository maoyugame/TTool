// Electron 主进程：创建无边框毛玻璃窗口，并通过 IPC 暴露桌面能力
// （剪贴板、打开第三方应用、选择应用路径、窗口控制）。
// 设计为可选壳层——核心 React 应用在浏览器中也能独立运行（见 src/platform）。
const { app, BrowserWindow, ipcMain, clipboard, shell, dialog, globalShortcut, screen, desktopCapturer, nativeImage, systemPreferences, Tray, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const { setupPlugins } = require('./plugins.cjs')
const { setupHost } = require('./host/index.cjs')
const { setupUpdater } = require('./updater.cjs')
const { searchFiles, searchDeep } = require('./filesearch.cjs')
const { captureFrozenDisplays, cropFrozenDisplayRegion } = require('./screenshot-freeze.cjs')
const { loadOverlayWithFrame, overlayFrameReceiverScript } = require('./screenshot-overlay-frame.cjs')
const { createCodexUsageService } = require('./codex-usage.cjs')
const { DEFAULT_CODEX_USAGE_CONFIG, normalizeWidgetOpacity, readCodexUsageConfigFile, writeCodexUsageConfigFile } = require('./codex-usage-config.cjs')

// 固定应用名，确保 userData（插件目录）路径稳定一致（dev 下默认会变成 "Electron"）。
app.setName('ttool')
if (process.platform === 'win32') app.setAppUserModelId('com.maoyugame.ttool')

const DEV_URL = process.env.TOOLBOX_DEV_URL
const APP_ICON = path.join(__dirname, '..', 'assets', 'icon', process.platform === 'win32' ? 'app.ico' : 'app.png')
let win = null
let host = null // 宿主能力（net / storage / secrets），whenReady 后初始化
let updaterHost = null // Windows NSIS 自动更新（仅安装版启用）
let launcher = null // 快速启动器小窗（Spotlight 式悬浮窗）
let tray = null
let isQuitting = false
const LAUNCHER_W = 720
let launcherHeight = 72 // 渲染层按内容动态上报；初始仅搜索栏高度

// ---- Codex 用量状态内置工具 ----
// 默认不启动任何子进程或悬浮窗；只有用户启用工具，或在工具页显式请求状态/显示悬浮窗时才按需创建。
let codexUsageConfig = { ...DEFAULT_CODEX_USAGE_CONFIG }
let codexUsageService = null
let codexUsageWidget = null

function codexUsageConfigFile() {
  return path.join(app.getPath('userData'), 'codex-usage-config.json')
}

function readCodexUsageConfig() {
  return readCodexUsageConfigFile(codexUsageConfigFile())
}

function writeCodexUsageConfig(config) {
  writeCodexUsageConfigFile(codexUsageConfigFile(), config)
}

function codexUsageState() {
  const base = codexUsageService
    ? codexUsageService.state()
    : { connection: 'idle', error: null, updatedAt: null, lastSuccessfulRefreshAt: null, rateLimits: null, usage: null }
  return {
    ...base,
    enabled: codexUsageConfig.enabled,
    widgetVisible: !!(codexUsageWidget && !codexUsageWidget.isDestroyed() && codexUsageWidget.isVisible()),
    widgetOpacity: codexUsageConfig.widgetOpacity,
  }
}

function broadcastCodexUsageState() {
  const state = codexUsageState()
  for (const target of [win, codexUsageWidget]) {
    if (target && !target.isDestroyed()) target.webContents.send('codex-usage:state', state)
  }
}

function getCodexUsageService() {
  if (!codexUsageService) {
    codexUsageService = createCodexUsageService({
      onState: broadcastCodexUsageState,
      clientVersion: codexUsageClientVersion(),
    })
  }
  return codexUsageService
}

function codexUsageClientVersion() {
  try {
    const version = app.getVersion()
    return typeof version === 'string' && version.trim() ? version.trim() : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function codexUsageWidgetHtml() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<style>
:root { color-scheme: dark; --widget-surface: rgba(22, 25, 34, .82); --widget-border: rgba(255,255,255,.14); --widget-text: #f5f7fb; --widget-muted: rgba(245,247,251,.68); --widget-accent: #73b7ff; --widget-track: rgba(255,255,255,.13); --widget-tick: rgba(245,247,251,.30); }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; user-select: none; }
.card { height: 100%; border: 1px solid var(--widget-border); border-radius: 16px; padding: 13px 14px; color: var(--widget-text); background: var(--widget-surface); backdrop-filter: blur(18px); box-shadow: 0 12px 35px rgba(0,0,0,.28); }
.top { display: flex; align-items: center; justify-content: space-between; margin: -5px -5px 8px; padding: 5px; border-radius: 9px; -webkit-app-region: drag; cursor: grab; }
.top:active { cursor: grabbing; }
.top::after { content: '拖动此处'; margin-left: 6px; font-size: 9px; color: var(--widget-muted); }
.title { font-size: 12px; font-weight: 700; letter-spacing: .04em; }
.status { font-size: 10px; color: var(--widget-muted); }
.line { display: grid; grid-template-columns: 43px 1fr 36px; align-items: center; gap: 8px; margin: 7px 0; font-size: 10px; color: var(--widget-muted); }
.bar { position: relative; height: 6px; overflow: hidden; border-radius: 99px; background: var(--widget-track); }
.bar::before { content: ''; position: absolute; inset: 1px 0; z-index: 0; pointer-events: none; background: repeating-linear-gradient(90deg, transparent 0, transparent calc(20% - 1px), var(--widget-tick) calc(20% - 1px), var(--widget-tick) 20%); }
.bar > i { position: relative; z-index: 1; display: block; height: 100%; border-radius: inherit; background: var(--widget-accent); transition: width .22s ease; }
.percent { color: var(--widget-text); text-align: right; font-variant-numeric: tabular-nums; }
.detail { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; margin-top: 7px; font-size: 10px; color: var(--widget-muted); }
</style></head><body><div class="card">
  <div class="top"><span class="title" id="title">Codex 用量</span><span class="status" id="status">连接中</span></div>
  <div class="line"><span id="primary-label">主窗口</span><div class="bar"><i id="primary-bar"></i></div><span class="percent" id="primary-value">—</span></div>
  <div class="line"><span id="secondary-label">次级</span><div class="bar"><i id="secondary-bar"></i></div><span class="percent" id="secondary-value">—</span></div>
  <div class="detail" id="detail">正在读取本机 Codex 状态</div>
</div><script>
const byId = (id) => document.getElementById(id)
function selectedLimit(state) {
  const limits = state && state.rateLimits
  if (!limits) return null
  return (limits.rateLimitsByLimitId && limits.rateLimitsByLimitId.codex) || limits.rateLimits || null
}
function windowName(minutes, fallback) {
  if (minutes === 300) return '5 小时'
  if (minutes === 10080) return '周限额'
  return minutes ? Math.round(minutes) + ' 分钟' : fallback
}
function formatCountdown(seconds) {
  const total = Math.max(0, Math.ceil(seconds))
  if (total < 60) return total + ' 秒'
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return minutes + ' 分'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + ' 时 ' + (minutes % 60) + ' 分'
  return Math.floor(hours / 24) + ' 天 ' + (hours % 24) + ' 时'
}
function resetCountdown(value, now) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '重置未知'
  const resetsAt = n < 1000000000000 ? n * 1000 : n
  if (resetsAt <= now) return '待重置'
  return '重置 ' + formatCountdown((resetsAt - now) / 1000)
}
function freshnessText(state, now) {
  const status = state && state.connection
  const refreshedAt = Number(state && state.lastSuccessfulRefreshAt)
  const hasRefresh = Number.isFinite(refreshedAt) && refreshedAt > 0
  if (status === 'error') return '刷新失败'
  if (!hasRefresh) return status === 'ready' ? '等待数据' : '连接中'
  if (now - refreshedAt > 120000) return '数据过期'
  return formatCountdown((now - refreshedAt) / 1000) + '前更新'
}
function renderWindow(prefix, data, fallback) {
  const rawPercent = Number(data && data.usedPercent)
  const percent = Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, rawPercent)) : 0
  byId(prefix + '-label').textContent = windowName(data && data.windowDurationMins, fallback)
  byId(prefix + '-bar').style.width = percent + '%'
  byId(prefix + '-value').textContent = data && Number.isFinite(rawPercent) ? '余 ' + Math.round(100 - percent) + '%' : '—'
}
let latestState = null
function render(state) {
  latestState = state
  const limit = selectedLimit(state)
  byId('title').textContent = limit && limit.limitName ? limit.limitName + ' 用量' : 'Codex 用量'
  renderWindow('primary', limit && limit.primary, '主窗口')
  renderWindow('secondary', limit && limit.secondary, '次级')
  const status = state && state.connection
  byId('status').textContent = status === 'ready' ? '实时' : status === 'error' ? '不可用' : status === 'idle' ? '已暂停' : '连接中'
  const now = Date.now()
  const primaryPercent = Number(limit && limit.primary && limit.primary.usedPercent)
  const remaining = Number.isFinite(primaryPercent) ? '余 ' + Math.round(100 - Math.max(0, Math.min(100, primaryPercent))) + '%' : ''
  const countdown = limit && limit.primary ? resetCountdown(limit.primary.resetsAt, now) : ''
  const freshness = freshnessText(state, now)
  byId('detail').textContent = remaining ? freshness + ' · ' + remaining + ' · ' + countdown : freshness
}
window.ttool.codexUsage.onState(render)
window.ttool.codexUsage.getState().then(render)
window.setInterval(function () { if (latestState) render(latestState) }, 1000)
</script></body></html>`
}

function showCodexUsageWidget() {
  const service = getCodexUsageService()
  service.start()
  if (codexUsageWidget && !codexUsageWidget.isDestroyed()) {
    try {
      codexUsageWidget.setOpacity(codexUsageConfig.widgetOpacity)
    } catch {
      /* 在不支持透明度的窗口管理器中保持默认显示。 */
    }
    codexUsageWidget.showInactive()
    broadcastCodexUsageState()
    return codexUsageState()
  }
  const display = screen.getPrimaryDisplay()
  const area = display.workArea
  const width = 296
  const height = 124
  codexUsageWidget = new BrowserWindow({
    x: area.x + area.width - width - 18,
    y: area.y + area.height - height - 18,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: true,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    opacity: codexUsageConfig.widgetOpacity,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  hardenWebContents(codexUsageWidget.webContents)
  try {
    codexUsageWidget.setAlwaysOnTop(true, 'screen-saver')
    codexUsageWidget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch {
    /* 平台不支持的窗口属性保持普通可交互窗口行为。 */
  }
  codexUsageWidget.once('ready-to-show', () => {
    if (codexUsageWidget && !codexUsageWidget.isDestroyed()) {
      codexUsageWidget.showInactive()
      broadcastCodexUsageState()
    }
  })
  codexUsageWidget.on('closed', () => {
    codexUsageWidget = null
    broadcastCodexUsageState()
  })
  codexUsageWidget.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(codexUsageWidgetHtml()))
  return codexUsageState()
}

function destroyCodexUsageWidget() {
  const widget = codexUsageWidget
  codexUsageWidget = null
  if (widget && !widget.isDestroyed()) widget.destroy()
}

function setCodexUsageEnabled(enabled) {
  codexUsageConfig = { ...codexUsageConfig, enabled: Boolean(enabled) }
  writeCodexUsageConfig(codexUsageConfig)
  if (codexUsageConfig.enabled) {
    showCodexUsageWidget()
  } else {
    destroyCodexUsageWidget()
    if (codexUsageService) codexUsageService.stop()
  }
  broadcastCodexUsageState()
  return codexUsageState()
}

function setCodexUsageWidgetOpacity(opacity) {
  codexUsageConfig = { ...codexUsageConfig, widgetOpacity: normalizeWidgetOpacity(opacity) }
  writeCodexUsageConfig(codexUsageConfig)
  if (codexUsageWidget && !codexUsageWidget.isDestroyed()) {
    try {
      codexUsageWidget.setOpacity(codexUsageConfig.widgetOpacity)
    } catch {
      /* 在不支持透明度的窗口管理器中保持默认显示。 */
    }
  }
  broadcastCodexUsageState()
  return codexUsageState()
}

function openCodexUsageForToolPage() {
  // 打开内置工具页属于用户的显式请求，此时才读取本机 Codex；不会在应用启动时预热。
  getCodexUsageService().start()
  return codexUsageState()
}

function releaseCodexUsageFromToolPage() {
  if (!codexUsageConfig.enabled && !codexUsageWidget && codexUsageService) codexUsageService.stop()
  return codexUsageState()
}

function initializeCodexUsage() {
  codexUsageConfig = readCodexUsageConfig()
  if (codexUsageConfig.enabled) showCodexUsageWidget()
}

function disposeCodexUsage() {
  destroyCodexUsageWidget()
  if (codexUsageService) codexUsageService.stop()
  codexUsageService = null
}

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

// ---- 截图贴图内置工具宿主能力 ----
const SCREENSHOT_TOOL_ID = 'screenshot-pin'
const DEFAULT_SCREENSHOT_CONFIG = {
  enabled: false,
  screenshot: 'Control+Alt+A',
  screenshotPin: 'Control+Alt+S',
}
const RESERVED_SCREENSHOT_SHORTCUTS = new Set(['Alt+Space', 'Control+Alt+Space'].map(acceleratorId))
let screenshotShortcutConfig = { ...DEFAULT_SCREENSHOT_CONFIG }
let screenshotShortcutStatuses = shortcutStatuses(screenshotShortcutConfig, false, { screenshot: '已关闭', screenshotPin: '已关闭' })
let registeredScreenshotAccelerators = new Set()
let activeCapture = null
let captureSeq = 0
let pinSeq = 0
let recentSeq = 0
let toastSeq = 0
const pendingCaptures = []
const recentScreenshots = []
const pins = new Map()
let captureToast = null
const RECENT_SCREENSHOT_LIMIT = 5

function screenshotConfigFile() {
  return path.join(app.getPath('userData'), 'screenshot-pin-config.json')
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function normalizeShortcutConfig(raw) {
  return {
    enabled: Boolean(raw && raw.enabled),
    screenshot: String((raw && raw.screenshot) || DEFAULT_SCREENSHOT_CONFIG.screenshot).trim() || DEFAULT_SCREENSHOT_CONFIG.screenshot,
    screenshotPin: String((raw && raw.screenshotPin) || DEFAULT_SCREENSHOT_CONFIG.screenshotPin).trim() || DEFAULT_SCREENSHOT_CONFIG.screenshotPin,
  }
}

function readScreenshotConfig() {
  try {
    const raw = fs.readFileSync(screenshotConfigFile(), 'utf8')
    return normalizeShortcutConfig(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SCREENSHOT_CONFIG }
  }
}

function writeScreenshotConfig(config) {
  try {
    fs.mkdirSync(path.dirname(screenshotConfigFile()), { recursive: true })
    fs.writeFileSync(screenshotConfigFile(), JSON.stringify(config, null, 2), 'utf8')
  } catch {
    /* 配置保存失败不影响当前会话注册状态 */
  }
}

function acceleratorId(acc) {
  const mods = []
  const main = []
  for (const raw of String(acc || '').split('+')) {
    const p = raw.trim()
    if (!p) continue
    const low = p.toLowerCase()
    if (low === 'ctrl' || low === 'control') mods.push('control')
    else if (low === 'cmd' || low === 'command') mods.push('command')
    else if (low === 'cmdorctrl' || low === 'commandorcontrol') mods.push('commandorcontrol')
    else if (low === 'option') mods.push('alt')
    else if (low === 'alt' || low === 'shift' || low === 'meta' || low === 'super') mods.push(low)
    else if (low === ' ') main.push('space')
    else main.push(low)
  }
  const order = ['commandorcontrol', 'command', 'control', 'alt', 'shift', 'meta', 'super']
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return [...mods, ...main].join('+')
}

function acceleratorHasModifierAndMain(acc) {
  const id = acceleratorId(acc)
  const parts = id.split('+').filter(Boolean)
  const modSet = new Set(['commandorcontrol', 'command', 'control', 'alt', 'shift', 'meta', 'super'])
  return parts.some((p) => modSet.has(p)) && parts.some((p) => !modSet.has(p))
}

function validateShortcutConfig(config) {
  const a = acceleratorId(config.screenshot)
  const b = acceleratorId(config.screenshotPin)
  if (!acceleratorHasModifierAndMain(config.screenshot) || !acceleratorHasModifierAndMain(config.screenshotPin)) return '快捷键需要至少一个修饰键和一个主键'
  if (a === b) return '两个截图快捷键不能相同'
  if (RESERVED_SCREENSHOT_SHORTCUTS.has(a) || RESERVED_SCREENSHOT_SHORTCUTS.has(b)) return '快捷键与 TTool 全局启动器快捷键冲突'
  return ''
}

function shortcutStatuses(config, registered, errors = {}) {
  return [
    { key: 'screenshot', accelerator: config.screenshot, registered: registered && !errors.screenshot, error: errors.screenshot },
    { key: 'screenshotPin', accelerator: config.screenshotPin, registered: registered && !errors.screenshotPin, error: errors.screenshotPin },
  ]
}

function unregisterScreenshotShortcuts() {
  for (const acc of registeredScreenshotAccelerators) {
    try {
      globalShortcut.unregister(acc)
    } catch {
      /* ignore */
    }
  }
  registeredScreenshotAccelerators.clear()
}

function tryApplyScreenshotShortcuts(config) {
  unregisterScreenshotShortcuts()
  if (!config.enabled) {
    return { ok: true, statuses: shortcutStatuses(config, false, { screenshot: '已关闭', screenshotPin: '已关闭' }) }
  }
  const validationError = validateShortcutConfig(config)
  if (validationError) {
    return { ok: false, error: validationError, statuses: shortcutStatuses(config, false, { screenshot: validationError, screenshotPin: validationError }) }
  }
  const entries = [
    { key: 'screenshot', accelerator: config.screenshot, action: 'edit' },
    { key: 'screenshotPin', accelerator: config.screenshotPin, action: 'pin' },
  ]
  const errors = {}
  const registered = []
  for (const item of entries) {
    try {
      const ok = globalShortcut.register(item.accelerator, () => {
        void startScreenshotCapture(item.action, true)
      })
      if (!ok) {
        errors[item.key] = '快捷键被占用'
        break
      }
      registered.push(item.accelerator)
    } catch (e) {
      errors[item.key] = e && e.message ? e.message : '快捷键注册失败'
      break
    }
  }
  if (Object.keys(errors).length) {
    for (const acc of registered) {
      try {
        globalShortcut.unregister(acc)
      } catch {
        /* ignore */
      }
    }
    registeredScreenshotAccelerators.clear()
    return { ok: false, error: '快捷键被占用，已保留原快捷键', statuses: shortcutStatuses(config, false, errors) }
  }
  registeredScreenshotAccelerators = new Set(registered)
  return { ok: true, statuses: shortcutStatuses(config, true) }
}

function initializeScreenshotShortcuts() {
  screenshotShortcutConfig = readScreenshotConfig()
  const applied = tryApplyScreenshotShortcuts(screenshotShortcutConfig)
  screenshotShortcutStatuses = applied.statuses
}

function setScreenshotConfig(nextRaw) {
  const next = normalizeShortcutConfig(nextRaw)
  const prev = { ...screenshotShortcutConfig }
  const applied = tryApplyScreenshotShortcuts(next)
  if (!applied.ok) {
    const restored = tryApplyScreenshotShortcuts(prev)
    screenshotShortcutStatuses = restored.statuses
    return { ok: false, config: prev, statuses: screenshotShortcutStatuses, error: applied.error || '快捷键注册失败，已保留原快捷键' }
  }
  screenshotShortcutConfig = next
  screenshotShortcutStatuses = applied.statuses
  writeScreenshotConfig(next)
  return { ok: true, config: next, statuses: screenshotShortcutStatuses }
}

function displayInfo(d) {
  const primaryId = screen.getPrimaryDisplay().id
  return {
    id: d.id,
    bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
    workArea: { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height },
    scaleFactor: d.scaleFactor || 1,
    primary: d.id === primaryId,
  }
}

function screenPermissionStatus() {
  if (process.platform !== 'darwin') return 'granted'
  try {
    return systemPreferences.getMediaAccessStatus('screen') || 'unknown'
  } catch {
    return 'unknown'
  }
}

function screenshotEnvironment() {
  return {
    isDesktop: true,
    platform: process.platform,
    permission: screenPermissionStatus(),
    displays: screen.getAllDisplays().map(displayInfo),
  }
}

function screenshotPreflightBlocker() {
  if (!screenshotShortcutConfig.enabled) return '截图贴图已关闭'
  if (activeCapture) return '截图进行中'
  const displays = screen.getAllDisplays()
  if (!displays.length) return '未检测到可用显示器'
  const permission = screenPermissionStatus()
  if (permission === 'denied' || permission === 'restricted' || permission === 'not-determined') return '需要屏幕录制权限'
  return ''
}

function sendToMain(channel, payload) {
  if (!win || win.isDestroyed()) createWindow()
  const send = () => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

function openToolInMain(id) {
  if (!win || win.isDestroyed()) createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  const send = () => win && !win.isDestroyed() && win.webContents.send('ttool:open-tool', id)
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

function showMainWindow() {
  if (!win || win.isDestroyed()) createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function hideMainWindowToTray() {
  if (!win || win.isDestroyed()) return
  win.hide()
}

function requestMainWindowClose() {
  hideMainWindowToTray()
  return { ok: true }
}

function createTray() {
  if (tray) return
  const icon = nativeImage.createFromPath(APP_ICON)
  tray = new Tray(icon)
  tray.setToolTip('TTool')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 TTool', click: showMainWindow },
    { type: 'separator' },
    {
      label: '退出 TTool',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]))
  tray.on('click', showMainWindow)
}

function emitScreenshotStatus(level, message) {
  if (win && !win.isDestroyed()) sendToMain('screenshot:status', { level, message })
}

function closeActiveOverlayWindows() {
  if (!activeCapture) return
  for (const overlay of activeCapture.windows) {
    try {
      if (!overlay.isDestroyed()) overlay.destroy()
    } catch {
      /* ignore */
    }
  }
  activeCapture.windows = []
}

function overlayHtml(captureId, d, action) {
  const meta = JSON.stringify({ captureId, displayId: d.id, defaultAction: action === 'pin' ? 'pin' : 'edit' })
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; cursor: none; user-select: none; font-family: system-ui,-apple-system,Segoe UI,sans-serif; }
#frozenFrame { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
#dim { position: fixed; inset: 0; background: rgba(0,0,0,.48); pointer-events: none; }
body.has-selection #dim { background: transparent; }
#cursorReticle { position: fixed; left: 0; top: 0; width: 16px; height: 16px; margin: -8px 0 0 -8px; pointer-events: none; z-index: 2147483647; transform: translate3d(-9999px,-9999px,0); opacity: .94; transition: opacity 70ms ease; }
#cursorReticle::before, #cursorReticle::after { content: ""; position: absolute; left: 50%; top: 50%; background: #f5ffff; box-shadow: 0 0 0 1px rgba(0,0,0,.82), 0 0 4px rgba(53,213,199,.48); transform: translate(-50%, -50%); }
#cursorReticle::before { width: 1px; height: 16px; }
#cursorReticle::after { width: 16px; height: 1px; }
#cursorReticle.hidden, #cursorReticle:not([data-cursor="crosshair"]) { opacity: 0; }
#sel { position: absolute; display: none; border: 2px solid #35d5c7; background: rgba(53,213,199,.04); box-shadow: 0 0 0 9999px rgba(0,0,0,.46), 0 0 0 1px rgba(255,255,255,.78) inset, 0 0 0 1px rgba(53,213,199,.25); box-sizing: border-box; cursor: default; touch-action: none; }
#anno { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
#textInput { position: absolute; display: none; min-width: 120px; max-width: calc(100% - 10px); height: 34px; z-index: 2; box-sizing: border-box; border: 1px solid #35d5c7; border-radius: 8px; padding: 0 8px; color: #ff4d4f; background: rgba(15,18,24,.96); outline: none; box-shadow: 0 8px 22px rgba(0,0,0,.28); }
#sel.invalid { border-color: #ff6b6b; background: rgba(255,107,107,.06); box-shadow: 0 0 0 9999px rgba(0,0,0,.48), 0 0 0 1px rgba(255,255,255,.72) inset, 0 0 0 1px rgba(255,107,107,.35); }
#chip { position: absolute; transform: translateY(calc(-100% - 7px)); padding: 4px 8px; border-radius: 8px; background: rgba(15,18,24,.92); color: #fff; font-size: 12px; line-height: 1.2; white-space: nowrap; box-shadow: 0 5px 16px rgba(0,0,0,.24); pointer-events: none; }
#sel.invalid #chip { background: rgba(92,20,25,.95); }
.handle { position: absolute; width: 9px; height: 9px; border-radius: 3px; background: #35d5c7; border: 1px solid rgba(255,255,255,.95); box-shadow: 0 2px 6px rgba(0,0,0,.28); box-sizing: border-box; }
#sel.invalid .handle { background: #ff6b6b; }
#bar { position: absolute; display: none; align-items: center; flex-wrap: wrap; gap: 6px; max-width: calc(100vw - 16px); max-height: min(220px, calc(100vh - 16px)); overflow: auto; padding: 7px; border-radius: 11px; background: rgba(15,18,24,.94); box-shadow: 0 10px 30px rgba(0,0,0,.34); cursor: default; }
.sep { width: 1px; height: 20px; background: rgba(255,255,255,.18); margin: 0 2px; }
button { height: 32px; min-width: 42px; border: 0; border-radius: 8px; padding: 0 11px; color: #fff; background: rgba(255,255,255,.15); font-size: 12px; font-weight: 650; cursor: pointer; }
button:hover:not(:disabled) { background: rgba(255,255,255,.22); }
button.primary { background: #1ba99a; }
button.primary:hover:not(:disabled) { background: #22bfae; }
button.active { color: #071416; background: #35d5c7; }
button.danger { color: #ffb1b1; }
button:disabled { opacity: .42; cursor: not-allowed; }
.anno-control { height: 32px; display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; border-radius: 8px; color: rgba(255,255,255,.9); background: rgba(255,255,255,.12); font-size: 11.5px; font-weight: 650; white-space: nowrap; box-sizing: border-box; }
.anno-control input[type="color"] { width: 26px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; }
.anno-control input[type="range"] { width: 76px; }
#sizeValue { min-width: 28px; text-align: right; color: #fff; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
#hint { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); padding: 8px 12px; border-radius: 10px; color: #fff; background: rgba(15,18,24,.76); font-size: 12px; pointer-events: none; }
</style>
</head>
<body>
<img id="frozenFrame" alt="" draggable="false" />
<div id="dim"></div>
<div id="cursorReticle" class="hidden" aria-hidden="true"></div>
<div id="hint">拖拽选择区域，选区后拖动边框调整大小，Esc 取消</div>
<div id="sel"><canvas id="anno"></canvas><input id="textInput" maxlength="120" /><div id="chip"></div></div>
<div id="bar">
  <button data-action="copy">复制</button>
  <button data-action="save">保存</button>
  <button data-action="pin">贴图</button>
  <span class="sep"></span>
  <button data-tool="">选择</button>
  <button data-tool="arrow">箭头</button>
  <button data-tool="rect">矩形</button>
  <button data-tool="circle">圆形</button>
  <button data-tool="brush">画笔</button>
  <button data-tool="text">文本</button>
  <button data-tool="mosaic">马赛克</button>
  <label class="anno-control" id="colorControl">颜色<input id="annoColor" type="color" value="#ff4d4f" /></label>
  <label class="anno-control" id="sizeControl"><span id="sizeLabel">线宽</span><input id="sizeRange" type="range" min="2" max="16" value="4" /><span id="sizeValue">4px</span></label>
  <button id="undoAnno">撤销</button>
  <button id="redoAnno">重做</button>
  <button id="clearAnno">清除</button>
  <span class="sep"></span>
  <button class="danger" id="cancel">取消</button>
  <button class="primary" data-action="default">✓</button>
</div>
<script>
const META = ${meta};
${overlayFrameReceiverScript()}
const MIN = 8;
const EDGE_HIT = 8;
const ANNO_MIN = 4;
const DEFAULT_ANNO_COLOR = '#ff4d4f';
const DEFAULT_LINE_WIDTH = 4;
const DEFAULT_FONT_SIZE = 28;
const DEFAULT_MOSAIC_SIZE = 32;
const TEXT_CLICK_DELAY = 220;
let start = null;
let rect = null;
let selecting = false;
let resizing = null;
let drawingAnnotation = null;
let annotations = [];
let undoStack = [];
let redoStack = [];
let activeTool = META.defaultAction === 'edit' ? 'arrow' : '';
let annoColor = DEFAULT_ANNO_COLOR;
let lineWidth = DEFAULT_LINE_WIDTH;
let fontSize = DEFAULT_FONT_SIZE;
let mosaicSize = DEFAULT_MOSAIC_SIZE;
let textDraft = null;
let textClickTimer = 0;
let completed = false;
let pendingInsideClick = false;
let downPoint = null;
let movedSinceDown = false;
const sel = document.getElementById('sel');
const anno = document.getElementById('anno');
const annoCtx = anno.getContext('2d');
const textInput = document.getElementById('textInput');
const cursorReticle = document.getElementById('cursorReticle');
const chip = document.getElementById('chip');
const bar = document.getElementById('bar');
const hint = document.getElementById('hint');
const colorInput = document.getElementById('annoColor');
const sizeRange = document.getElementById('sizeRange');
const sizeLabel = document.getElementById('sizeLabel');
const sizeValue = document.getElementById('sizeValue');
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function pointInRect(p, r) { return Boolean(r && p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height); }
function rectFromPoints(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }; }
function isInteractive(target) { return Boolean(target.closest && target.closest('button, #bar, #chip, #textInput')); }
function isValid() { return Boolean(rect && rect.width >= MIN && rect.height >= MIN); }
function isAnnotationTool(tool) { return ['arrow', 'rect', 'circle', 'brush', 'text', 'mosaic'].includes(tool); }
function cursorForEdge(edge) {
  if (edge === 'n' || edge === 's') return 'ns-resize';
  if (edge === 'e' || edge === 'w') return 'ew-resize';
  if (edge === 'nw' || edge === 'se') return 'nwse-resize';
  return 'nesw-resize';
}
function setOverlayCursor(cursor) {
  const nativeCursor = cursor === 'crosshair' ? 'none' : cursor;
  document.body.style.cursor = nativeCursor;
  sel.style.cursor = nativeCursor;
  cursorReticle.setAttribute('data-cursor', cursor);
}
function edgeFromTarget(target) {
  const handle = target && target.closest && target.closest('.handle');
  return handle ? handle.getAttribute('data-edge') || '' : '';
}
function resizeEdgeFromPoint(p, r) {
  if (!r) return '';
  const inX = p.x >= r.x - EDGE_HIT && p.x <= r.x + r.width + EDGE_HIT;
  const inY = p.y >= r.y - EDGE_HIT && p.y <= r.y + r.height + EDGE_HIT;
  const nearTop = inX && Math.abs(p.y - r.y) <= EDGE_HIT;
  const nearBottom = inX && Math.abs(p.y - (r.y + r.height)) <= EDGE_HIT;
  const nearLeft = inY && Math.abs(p.x - r.x) <= EDGE_HIT;
  const nearRight = inY && Math.abs(p.x - (r.x + r.width)) <= EDGE_HIT;
  const vertical = nearTop ? 'n' : nearBottom ? 's' : '';
  const horizontal = nearLeft ? 'w' : nearRight ? 'e' : '';
  return vertical + horizontal;
}
function resizeEdgeForEvent(target, p) {
  return edgeFromTarget(target) || resizeEdgeFromPoint(p, rect);
}
function updateHoverCursor(p) {
  if (!completed || selecting || resizing || !rect) {
    setOverlayCursor('crosshair');
    return;
  }
  const edge = resizeEdgeFromPoint(p, rect);
  setOverlayCursor(edge ? cursorForEdge(edge) : (pointInRect(p, rect) && !activeTool ? 'default' : 'crosshair'));
}
function cursorReticleShouldHide(target, p) {
  const interactive = target && target.closest && target.closest('#bar, button, input, .handle');
  return Boolean(interactive || (completed && !resizing && rect && resizeEdgeFromPoint(p, rect)));
}
function updateCursorReticle(p, target) {
  cursorReticle.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)';
  cursorReticle.classList.toggle('hidden', cursorReticleShouldHide(target, p));
}
function targetAtPoint(p) {
  return document.elementFromPoint(p.x, p.y);
}
let sending = false;
function updateButtons() {
  const valid = isValid();
  sel.classList.toggle('invalid', Boolean(rect) && !valid);
  chip.textContent = valid || !rect ? (rect ? rect.width + ' × ' + rect.height : '') : '选区过小';
  bar.querySelectorAll('button[data-action]').forEach((btn) => { btn.disabled = !valid || sending; });
  bar.querySelectorAll('button[data-tool]').forEach((btn) => {
    const tool = btn.getAttribute('data-tool');
    btn.disabled = !valid || sending;
    btn.classList.toggle('active', tool === activeTool);
  });
  document.getElementById('undoAnno').disabled = sending || undoStack.length === 0;
  document.getElementById('redoAnno').disabled = sending || redoStack.length === 0;
  document.getElementById('clearAnno').disabled = sending || annotations.length === 0;
  document.getElementById('cancel').disabled = sending;
  colorInput.disabled = sending || !isAnnotationTool(activeTool) || activeTool === 'mosaic';
  sizeRange.disabled = sending || !isAnnotationTool(activeTool);
}
function showBridgeError(message) {
  sending = false;
  hint.textContent = message || '截图失败，请重试';
  hint.style.background = 'rgba(92,20,25,.92)';
  updateButtons();
}
function annotationHint() {
  if (!activeTool) return '选择模式：双击选区确认，或拖出新区域';
  if (activeTool === 'text') return '单击添加文本，双击选区确认提交';
  if (activeTool === 'mosaic') return '在选区内拖拽涂抹马赛克，双击确认提交';
  const names = { arrow: '箭头', rect: '矩形', circle: '圆形', brush: '画笔' };
  return '在选区内拖拽绘制' + (names[activeTool] || '标注') + '，双击确认提交';
}
function setActiveTool(tool) {
  activeTool = isAnnotationTool(tool) ? tool : '';
  commitTextInput();
  drawingAnnotation = null;
  updateSizeControl();
  hint.textContent = annotationHint();
  updateHoverCursor(downPoint || { x: 0, y: 0 });
  updateButtons();
}
function updateSizeControl() {
  if (activeTool === 'text') {
    sizeLabel.textContent = '字号';
    sizeRange.min = '14';
    sizeRange.max = '64';
    sizeRange.value = String(fontSize);
    sizeValue.textContent = fontSize + 'px';
  } else if (activeTool === 'mosaic') {
    sizeLabel.textContent = '马赛克';
    sizeRange.min = '12';
    sizeRange.max = '72';
    sizeRange.value = String(mosaicSize);
    sizeValue.textContent = mosaicSize + 'px';
  } else {
    sizeLabel.textContent = '线宽';
    sizeRange.min = '2';
    sizeRange.max = '16';
    sizeRange.value = String(lineWidth);
    sizeValue.textContent = lineWidth + 'px';
  }
}
function localPoint(p) {
  return {
    x: clamp(p.x - rect.x, 0, rect.width),
    y: clamp(p.y - rect.y, 0, rect.height),
  };
}
function clonePoint(p) { return { x: p.x, y: p.y }; }
function cloneAnnotationShape(shape) {
  if (shape.kind === 'brush' || shape.kind === 'mosaic') return { ...shape, points: shape.points.map(clonePoint) };
  return { ...shape };
}
function snapshotAnnotations() {
  return annotations.map(cloneAnnotationShape);
}
function applyAnnotationChange(next) {
  undoStack.unshift(snapshotAnnotations());
  undoStack = undoStack.slice(0, 40);
  redoStack = [];
  annotations = next.map(cloneAnnotationShape);
  redrawAnnotations();
  updateButtons();
}
function commitAnnotation(shape) {
  if (!isValidAnnotationShape(shape)) return;
  applyAnnotationChange([...annotations, shape]);
}
function undoAnnotation() {
  if (!undoStack.length) return;
  redoStack.unshift(snapshotAnnotations());
  annotations = undoStack.shift();
  redrawAnnotations();
  updateButtons();
}
function redoAnnotation() {
  if (!redoStack.length) return;
  undoStack.unshift(snapshotAnnotations());
  annotations = redoStack.shift();
  redrawAnnotations();
  updateButtons();
}
function syncAnnotationCanvas() {
  const w = Math.max(1, rect ? rect.width : 1);
  const h = Math.max(1, rect ? rect.height : 1);
  if (anno.width !== w) anno.width = w;
  if (anno.height !== h) anno.height = h;
}
function drawArrow(ctx, shape) {
  const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
  const width = Math.max(1, shape.width || lineWidth);
  const head = Math.max(12, width * 5);
  ctx.strokeStyle = shape.color || annoColor;
  ctx.fillStyle = shape.color || annoColor;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(shape.x1, shape.y1);
  ctx.lineTo(shape.x2, shape.y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(shape.x2, shape.y2);
  ctx.lineTo(shape.x2 - head * Math.cos(angle - Math.PI / 6), shape.y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(shape.x2 - head * Math.cos(angle + Math.PI / 6), shape.y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}
function drawPolyline(ctx, shape) {
  if (!shape.points || shape.points.length < 2) return;
  ctx.strokeStyle = shape.color || annoColor;
  ctx.lineWidth = Math.max(1, shape.width || lineWidth);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(shape.points[0].x, shape.points[0].y);
  shape.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.stroke();
}
function drawMosaicPreview(ctx, shape) {
  if (!shape.points || shape.points.length < 1) return;
  const radius = Math.max(6, (shape.size || mosaicSize) / 2);
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.26)';
  ctx.strokeStyle = 'rgba(53,213,199,.82)';
  ctx.lineWidth = 1;
  for (const p of shape.points) {
    ctx.beginPath();
    ctx.rect(p.x - radius, p.y - radius, radius * 2, radius * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
function drawAnnotationShape(ctx, shape) {
  ctx.save();
  ctx.strokeStyle = shape.color || annoColor;
  ctx.fillStyle = shape.color || annoColor;
  ctx.lineWidth = Math.max(1, shape.lineWidth || lineWidth);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (shape.kind === 'arrow') {
    drawArrow(ctx, shape);
  } else if (shape.kind === 'rect') {
    ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
  } else if (shape.kind === 'circle') {
    ctx.beginPath();
    ctx.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, Math.max(0.5, shape.width / 2), Math.max(0.5, shape.height / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape.kind === 'brush') {
    drawPolyline(ctx, shape);
  } else if (shape.kind === 'text') {
    ctx.font = Math.max(12, shape.fontSize || fontSize) + 'px system-ui,-apple-system,Segoe UI,sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(shape.text, shape.x, shape.y);
  } else if (shape.kind === 'mosaic') {
    drawMosaicPreview(ctx, shape);
  }
  ctx.restore();
}
function draftAnnotationShape() {
  return drawingAnnotation ? drawingAnnotation.shape : null;
}
function redrawAnnotations() {
  syncAnnotationCanvas();
  annoCtx.clearRect(0, 0, anno.width, anno.height);
  annotations.forEach((shape) => drawAnnotationShape(annoCtx, shape));
  const draft = draftAnnotationShape();
  if (draft) drawAnnotationShape(annoCtx, draft);
}
function discardAnnotations() {
  annotations = [];
  undoStack = [];
  redoStack = [];
  drawingAnnotation = null;
  cancelPendingText();
  hideTextInput();
}
function beginAnnotation(p) {
  if (!rect || !isAnnotationTool(activeTool) || !pointInRect(p, rect)) return false;
  const local = localPoint(p);
  if (activeTool === 'text') {
    scheduleTextInput(local);
    return true;
  }
  const color = annoColor;
  if (activeTool === 'arrow') drawingAnnotation = { start: local, shape: { kind: 'arrow', x1: local.x, y1: local.y, x2: local.x, y2: local.y, color, width: lineWidth } };
  else if (activeTool === 'rect') drawingAnnotation = { start: local, shape: { kind: 'rect', x: local.x, y: local.y, width: 0, height: 0, color, lineWidth } };
  else if (activeTool === 'circle') drawingAnnotation = { start: local, shape: { kind: 'circle', x: local.x, y: local.y, width: 0, height: 0, color, lineWidth } };
  else if (activeTool === 'brush') drawingAnnotation = { start: local, shape: { kind: 'brush', points: [local], color, width: lineWidth } };
  else drawingAnnotation = { start: local, shape: { kind: 'mosaic', points: [local], size: mosaicSize, block: Math.max(6, Math.round(mosaicSize / 3)) } };
  hint.textContent = annotationHint();
  setOverlayCursor('crosshair');
  redrawAnnotations();
  return true;
}
function updateAnnotation(p) {
  if (!drawingAnnotation) return;
  const local = localPoint(p);
  const shape = drawingAnnotation.shape;
  if (shape.kind === 'arrow') {
    shape.x2 = local.x;
    shape.y2 = local.y;
  } else if (shape.kind === 'rect' || shape.kind === 'circle') {
    const r = rectFromPoints(drawingAnnotation.start, local);
    shape.x = r.x;
    shape.y = r.y;
    shape.width = r.width;
    shape.height = r.height;
  } else if (shape.kind === 'brush' || shape.kind === 'mosaic') {
    const last = shape.points[shape.points.length - 1];
    if (!last || Math.hypot(local.x - last.x, local.y - last.y) >= 1) shape.points.push(local);
  }
  redrawAnnotations();
}
function finishAnnotation(p) {
  if (!drawingAnnotation) return;
  updateAnnotation(p);
  const shape = draftAnnotationShape();
  drawingAnnotation = null;
  if (shape) commitAnnotation(shape);
  hint.textContent = annotationHint();
  redrawAnnotations();
  updateButtons();
}
function isValidAnnotationShape(shape) {
  if (!shape) return false;
  if (shape.kind === 'arrow') return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) >= ANNO_MIN;
  if (shape.kind === 'rect' || shape.kind === 'circle') return shape.width >= ANNO_MIN && shape.height >= ANNO_MIN;
  if (shape.kind === 'brush' || shape.kind === 'mosaic') return shape.points && shape.points.length >= 2;
  return shape.kind === 'text' && String(shape.text || '').trim().length > 0;
}
function cancelPendingText() {
  if (textClickTimer) window.clearTimeout(textClickTimer);
  textClickTimer = 0;
}
function scheduleTextInput(local) {
  cancelPendingText();
  textClickTimer = window.setTimeout(() => {
    textClickTimer = 0;
    showTextInput(local);
  }, TEXT_CLICK_DELAY);
}
function showTextInput(local) {
  textDraft = {
    x: clamp(local.x, 0, Math.max(0, rect.width - 24)),
    y: clamp(local.y, 0, Math.max(0, rect.height - fontSize - 10)),
  };
  textInput.value = '';
  textInput.style.left = textDraft.x + 'px';
  textInput.style.top = textDraft.y + 'px';
  textInput.style.height = Math.max(32, fontSize + 10) + 'px';
  textInput.style.fontSize = Math.max(12, fontSize) + 'px';
  textInput.style.color = annoColor;
  textInput.style.display = 'block';
  textInput.focus({ preventScroll: true });
}
function hideTextInput() {
  textInput.style.display = 'none';
  textInput.value = '';
  textDraft = null;
}
function commitTextInput() {
  cancelPendingText();
  if (!textDraft) return;
  const text = textInput.value.trim();
  const shape = { kind: 'text', x: textDraft.x, y: textDraft.y, text, color: annoColor, fontSize };
  hideTextInput();
  if (text) commitAnnotation(shape);
}
function annotationPayload() {
  commitTextInput();
  return annotations.map((shape) => {
    if (shape.kind === 'arrow') return { kind: 'arrow', x1: Math.round(shape.x1), y1: Math.round(shape.y1), x2: Math.round(shape.x2), y2: Math.round(shape.y2), color: shape.color, width: shape.width };
    if (shape.kind === 'brush') return { kind: 'brush', points: shape.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })), color: shape.color, width: shape.width };
    if (shape.kind === 'text') return { kind: 'text', x: Math.round(shape.x), y: Math.round(shape.y), text: shape.text, color: shape.color, fontSize: shape.fontSize };
    if (shape.kind === 'mosaic') return { kind: 'mosaic', points: shape.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })), size: shape.size, block: shape.block };
    return { kind: shape.kind, x: Math.round(shape.x), y: Math.round(shape.y), width: Math.round(shape.width), height: Math.round(shape.height), color: shape.color, lineWidth: shape.lineWidth };
  });
}
function overlayUrl(kind, payload) {
  return 'ttool-overlay://' + kind + '?payload=' + encodeURIComponent(JSON.stringify(payload));
}
function fallbackOverlay(kind, payload) {
  try {
    window.location.href = overlayUrl(kind, payload);
  } catch (e) {
    showBridgeError('截图桥接不可用，请重试');
  }
}
function sendOverlay(kind, payload) {
  if (sending) return;
  sending = true;
  updateButtons();
  const api = window.ttool && window.ttool.screenshot;
  const method = api && (kind === 'cancel' ? api.overlayCancel : api.overlaySelect);
  if (typeof method === 'function') {
    Promise.resolve(method(payload))
      .then((result) => {
        if (result && result.ok === false) showBridgeError(result.error);
      })
      .catch(() => fallbackOverlay(kind, payload));
    return;
  }
  fallbackOverlay(kind, payload);
}
function positionChip() {
  if (!rect) return;
  const chipW = chip.offsetWidth || 72;
  const maxLeft = Math.max(0, rect.width - chipW);
  const leftLimit = Math.max(0, innerWidth - rect.x - chipW - 8);
  chip.style.left = Math.min(maxLeft, leftLimit) + 'px';
  if (rect.y > chip.offsetHeight + 12) {
    chip.style.top = '0';
    chip.style.transform = 'translateY(calc(-100% - 7px))';
  } else {
    chip.style.top = '6px';
    chip.style.transform = 'none';
  }
}
function setRect(r) {
  const x = Math.round(clamp(r.x, 0, innerWidth));
  const y = Math.round(clamp(r.y, 0, innerHeight));
  rect = {
    x,
    y,
    width: Math.round(clamp(r.width, 0, innerWidth - x)),
    height: Math.round(clamp(r.height, 0, innerHeight - y)),
  };
  document.body.classList.add('has-selection');
  sel.style.display = 'block';
  sel.style.left = rect.x + 'px';
  sel.style.top = rect.y + 'px';
  sel.style.width = rect.width + 'px';
  sel.style.height = rect.height + 'px';
  redrawAnnotations();
  updateButtons();
  positionChip();
  renderHandles();
}
function renderHandles() {
  sel.querySelectorAll('.handle').forEach((n) => n.remove());
  const pos = [['nw',0,0],['n',50,0],['ne',100,0],['w',0,50],['e',100,50],['sw',0,100],['s',50,100],['se',100,100]];
  for (const p of pos) {
    const h = document.createElement('i');
    h.className = 'handle';
    h.setAttribute('data-edge', p[0]);
    h.style.left = 'calc(' + p[1] + '% - 4.5px)';
    h.style.top = 'calc(' + p[2] + '% - 4.5px)';
    h.style.cursor = cursorForEdge(p[0]);
    sel.appendChild(h);
  }
}
function updateBar() {
  if (!rect) return;
  bar.style.display = 'flex';
  updateButtons();
  const bw = bar.offsetWidth || 360;
  const bh = bar.offsetHeight || 46;
  const below = rect.y + rect.height + 10;
  const above = rect.y - bh - 10;
  const x = clamp(rect.x + rect.width / 2 - bw / 2, 8, Math.max(8, innerWidth - bw - 8));
  const y = below + bh + 8 <= innerHeight ? below : clamp(above, 8, Math.max(8, innerHeight - bh - 8));
  bar.style.left = x + 'px';
  bar.style.top = y + 'px';
}
function beginSelection(p) {
  selecting = true;
  resizing = null;
  discardAnnotations();
  completed = false;
  pendingInsideClick = false;
  bar.style.display = 'none';
  hint.textContent = '拖拽选择区域，选区后拖动边框调整大小，Esc 取消';
  setOverlayCursor('crosshair');
  start = p;
  setRect({ x: start.x, y: start.y, width: 0, height: 0 });
}
function updateSelection(p) {
  const x = Math.min(start.x, p.x);
  const y = Math.min(start.y, p.y);
  setRect({ x, y, width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) });
}
function beginResize(edge) {
  if (!rect || !edge) return;
  discardAnnotations();
  redrawAnnotations();
  resizing = { edge, origin: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  selecting = false;
  completed = false;
  pendingInsideClick = false;
  bar.style.display = 'none';
  hint.textContent = '拖动边框调整区域，松开完成';
  setOverlayCursor(cursorForEdge(edge));
}
function updateResize(p) {
  if (!resizing) return;
  const edge = resizing.edge;
  const origin = resizing.origin;
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.width;
  let bottom = origin.y + origin.height;
  if (edge.includes('w')) left = clamp(p.x, 0, right);
  if (edge.includes('e')) right = clamp(p.x, left, innerWidth);
  if (edge.includes('n')) top = clamp(p.y, 0, bottom);
  if (edge.includes('s')) bottom = clamp(p.y, top, innerHeight);
  setRect({ x: left, y: top, width: right - left, height: bottom - top });
}
function finishResize(p) {
  if (!resizing) return;
  resizing = null;
  completed = true;
  hint.textContent = annotationHint();
  updateBar();
  updateHoverCursor(p);
  updateCursorReticle(p, targetAtPoint(p));
}
function submit(action) {
  if (!isValid()) {
    updateButtons();
    return;
  }
  const resolved = action === 'default' ? META.defaultAction : action;
  sendOverlay('select', { captureId: META.captureId, displayId: META.displayId, rect, action: resolved, annotations: annotationPayload() });
}
window.addEventListener('mousedown', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  updateCursorReticle(p, e.target);
  if (isInteractive(e.target)) return;
  downPoint = p;
  movedSinceDown = false;
  if (completed && isValid() && pointInRect(p, rect) && e.detail >= 2) {
    e.preventDefault();
    cancelPendingText();
    return;
  }
  const edge = completed ? resizeEdgeForEvent(e.target, p) : '';
  if (edge) {
    e.preventDefault();
    beginResize(edge);
    return;
  }
  if (completed && isValid() && pointInRect(p, rect) && activeTool) {
    e.preventDefault();
    beginAnnotation(p);
    return;
  }
  if (completed && isValid() && pointInRect(p, rect)) {
    pendingInsideClick = true;
    return;
  }
  beginSelection(p);
});
window.addEventListener('mousemove', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  updateCursorReticle(p, e.target);
  if (resizing) {
    updateResize(p);
    return;
  }
  if (drawingAnnotation) {
    updateAnnotation(p);
    return;
  }
  if (downPoint && Math.hypot(p.x - downPoint.x, p.y - downPoint.y) > 4) movedSinceDown = true;
  if (pendingInsideClick && movedSinceDown && downPoint) beginSelection(downPoint);
  if (!selecting || !start) {
    updateHoverCursor(p);
    return;
  }
  updateSelection(p);
});
window.addEventListener('mouseup', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  updateCursorReticle(p, e.target);
  if (resizing) {
    finishResize(p);
    return;
  }
  if (drawingAnnotation) {
    finishAnnotation(p);
    return;
  }
  if (pendingInsideClick) {
    pendingInsideClick = false;
    return;
  }
  if (!selecting) return;
  selecting = false;
  completed = true;
  hint.textContent = annotationHint();
  updateBar();
  updateCursorReticle(p, targetAtPoint(p));
});
window.addEventListener('dblclick', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  updateCursorReticle(p, e.target);
  cancelPendingText();
  if (isInteractive(e.target) || movedSinceDown || selecting || resizing || drawingAnnotation || !completed || !isValid() || !pointInRect(p, rect)) return;
  submit('default');
});
window.addEventListener('mouseenter', (e) => {
  updateCursorReticle({ x: e.clientX, y: e.clientY }, e.target);
});
window.addEventListener('mouseleave', () => {
  cursorReticle.classList.add('hidden');
});
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undoAnnotation();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault();
    redoAnnotation();
    return;
  }
  if (e.key === 'Escape' && drawingAnnotation) {
    e.preventDefault();
    drawingAnnotation = null;
    redrawAnnotations();
    hint.textContent = annotationHint();
    return;
  }
  if (e.key === 'Escape' && (textDraft || textClickTimer)) {
    e.preventDefault();
    cancelPendingText();
    hideTextInput();
    return;
  }
  if (e.key === 'Escape') sendOverlay('cancel', { captureId: META.captureId, reason: '截图已取消' });
});
textInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    e.preventDefault();
    commitTextInput();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideTextInput();
  }
});
textInput.addEventListener('blur', () => {
  window.setTimeout(commitTextInput, 0);
});
colorInput.addEventListener('input', () => {
  annoColor = colorInput.value || DEFAULT_ANNO_COLOR;
  textInput.style.color = annoColor;
});
sizeRange.addEventListener('input', () => {
  const value = Number(sizeRange.value) || 0;
  if (activeTool === 'text') fontSize = clamp(Math.round(value), 14, 64);
  else if (activeTool === 'mosaic') mosaicSize = clamp(Math.round(value), 12, 72);
  else lineWidth = clamp(Math.round(value), 2, 16);
  updateSizeControl();
});
document.getElementById('cancel').onclick = () => sendOverlay('cancel', { captureId: META.captureId, reason: '截图已取消' });
bar.querySelectorAll('button[data-tool]').forEach((btn) => {
  btn.onclick = () => setActiveTool(btn.getAttribute('data-tool'));
});
document.getElementById('undoAnno').onclick = () => {
  undoAnnotation();
};
document.getElementById('redoAnno').onclick = () => {
  redoAnnotation();
};
document.getElementById('clearAnno').onclick = () => {
  if (!annotations.length) return;
  applyAnnotationChange([]);
};
bar.querySelectorAll('button[data-action]').forEach((btn) => {
  btn.onclick = () => submit(btn.getAttribute('data-action'));
});
updateSizeControl();
window.focus();
</script>
</body>
</html>`
}

function parseOverlayBridgeUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'ttool-overlay:') return null
  const kind = url.hostname || url.pathname.replace(/^\/+/, '')
  if (kind !== 'select' && kind !== 'cancel') return null
  let payload = {}
  try {
    payload = JSON.parse(url.searchParams.get('payload') || '{}')
  } catch {
    payload = {}
  }
  return { kind, payload }
}

function handleOverlayBridgeNavigation(event, rawUrl) {
  const request = parseOverlayBridgeUrl(rawUrl)
  if (!request) return false
  if (event && typeof event.preventDefault === 'function') event.preventDefault()
  const action = request.kind === 'cancel'
    ? Promise.resolve(cancelOverlaySelection(request.payload && request.payload.reason))
    : Promise.resolve(completeOverlaySelection(request.payload || {}))
  action.catch((e) => {
    const msg = e && e.message ? e.message : '截图失败，请重试'
    emitScreenshotStatus('error', msg)
    cancelOverlaySelection(msg)
  })
  return true
}

function createOverlayWindow(captureId, display, action, frozenFrame) {
  const overlay = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
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
    focusable: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  overlay.webContents.on('will-navigate', (event, targetUrl) => {
    handleOverlayBridgeNavigation(event, targetUrl)
  })
  overlay.webContents.on('will-redirect', (event, targetUrl) => {
    handleOverlayBridgeNavigation(event, targetUrl)
  })
  overlay.webContents.setWindowOpenHandler(({ url }) => {
    return handleOverlayBridgeNavigation(null, url) ? { action: 'deny' } : { action: 'deny' }
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  const png = frozenFrame.image.toPNG()
  const { ready } = loadOverlayWithFrame(overlay, overlayHtml(captureId, display, action), {
    captureId,
    displayId: display.id,
    png,
  })
  return { window: overlay, ready }
}

async function startScreenshotCapture(action, fromShortcut = false) {
  const blocker = screenshotPreflightBlocker()
  if (blocker) {
    if (!fromShortcut || blocker !== '截图贴图已关闭') emitScreenshotStatus('error', blocker)
    return { ok: false, error: blocker }
  }
  try {
    const captureId = 'cap_' + Date.now().toString(36) + '_' + (++captureSeq).toString(36)
    const displays = screen.getAllDisplays().map(displayInfo)
    activeCapture = { id: captureId, action, windows: [], displays, frozenFrames: new Map() }
    const frozenFrames = await captureFrozenDisplays(desktopCapturer, displays)
    activeCapture.frozenFrames = frozenFrames
    const overlays = displays.map((display) => createOverlayWindow(captureId, display, action, frozenFrames.get(String(display.id))))
    activeCapture.windows = overlays.map((item) => item.window)
    await Promise.all(overlays.map((item) => item.ready))
    for (const overlay of activeCapture.windows) {
      if (!overlay.isDestroyed()) overlay.show()
    }
    const primaryOverlay = displays.findIndex((display) => display.primary)
    const focusedOverlay = activeCapture.windows[primaryOverlay >= 0 ? primaryOverlay : 0]
    if (focusedOverlay && !focusedOverlay.isDestroyed()) focusedOverlay.focus()
    return { ok: true }
  } catch (e) {
    closeActiveOverlayWindows()
    activeCapture = null
    const msg = e && e.message ? e.message : '截图失败，请重试'
    emitScreenshotStatus('error', msg)
    return { ok: false, error: msg }
  }
}

function normalizeOverlayAnnotations(raw, rect) {
  if (!Array.isArray(raw) || !rect) return []
  const maxW = Math.max(1, Number(rect.width) || 1)
  const maxH = Math.max(1, Number(rect.height) || 1)
  const items = []
  const safeColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#ff4d4f'
  const safePoint = (value) => ({
    x: clamp(Math.round(Number(value && value.x) || 0), 0, maxW),
    y: clamp(Math.round(Number(value && value.y) || 0), 0, maxH),
  })
  for (const item of raw.slice(0, 120)) {
    const kind = item && ['arrow', 'rect', 'circle', 'brush', 'text', 'mosaic'].includes(item.kind) ? item.kind : ''
    if (!kind) continue
    if (kind === 'arrow') {
      const a = safePoint({ x: item.x1, y: item.y1 })
      const b = safePoint({ x: item.x2, y: item.y2 })
      if (Math.hypot(b.x - a.x, b.y - a.y) < 4) continue
      items.push({ kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: safeColor(item.color), width: clamp(Math.round(Number(item.width) || 4), 1, 24) })
      continue
    }
    if (kind === 'rect' || kind === 'circle') {
      const x1 = Number(item.x) || 0
      const y1 = Number(item.y) || 0
      const x2 = x1 + (Number(item.width) || 0)
      const y2 = y1 + (Number(item.height) || 0)
      const left = clamp(Math.round(Math.min(x1, x2)), 0, maxW)
      const top = clamp(Math.round(Math.min(y1, y2)), 0, maxH)
      const right = clamp(Math.round(Math.max(x1, x2)), 0, maxW)
      const bottom = clamp(Math.round(Math.max(y1, y2)), 0, maxH)
      const width = right - left
      const height = bottom - top
      if (width < 4 || height < 4) continue
      items.push({ kind, x: left, y: top, width, height, color: safeColor(item.color), lineWidth: clamp(Math.round(Number(item.lineWidth) || 4), 1, 24) })
      continue
    }
    if (kind === 'brush' || kind === 'mosaic') {
      const points = Array.isArray(item.points) ? item.points.slice(0, 600).map(safePoint) : []
      if (points.length < 2) continue
      if (kind === 'brush') {
        items.push({ kind, points, color: safeColor(item.color), width: clamp(Math.round(Number(item.width) || 4), 1, 24) })
      } else {
        const size = clamp(Math.round(Number(item.size) || 32), 8, 96)
        items.push({ kind, points, size, block: clamp(Math.round(Number(item.block) || Math.max(6, size / 3)), 4, 48) })
      }
      continue
    }
    const text = String(item.text || '').trim().slice(0, 120)
    if (!text) continue
    const point = safePoint(item)
    items.push({ kind, x: point.x, y: point.y, text, color: safeColor(item.color), fontSize: clamp(Math.round(Number(item.fontSize) || 28), 10, 96) })
  }
  return items
}

function annotatedCaptureHtml(payload) {
  const json = JSON.stringify(payload)
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body>
<script>
const payload = ${json};
function scaledPoint(point, scaleX, scaleY) {
  return { x: point.x * scaleX, y: point.y * scaleY };
}
function drawArrow(ctx, shape, scaleX, scaleY) {
  const a = { x: shape.x1 * scaleX, y: shape.y1 * scaleY };
  const b = { x: shape.x2 * scaleX, y: shape.y2 * scaleY };
  const width = Math.max(1, (shape.width || 4) * ((scaleX + scaleY) / 2));
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = Math.max(12, width * 5);
  ctx.save();
  ctx.strokeStyle = shape.color || '#ff4d4f';
  ctx.fillStyle = shape.color || '#ff4d4f';
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function drawBrush(ctx, shape, scaleX, scaleY) {
  const points = (shape.points || []).map((p) => scaledPoint(p, scaleX, scaleY));
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = shape.color || '#ff4d4f';
  ctx.lineWidth = Math.max(1, (shape.width || 4) * ((scaleX + scaleY) / 2));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}
function drawMosaicPatch(ctx, cx, cy, size, blockSize) {
  const radius = Math.max(4, size / 2);
  const x = Math.max(0, Math.floor(cx - radius));
  const y = Math.max(0, Math.floor(cy - radius));
  const w = Math.min(ctx.canvas.width - x, Math.ceil(radius * 2));
  const h = Math.min(ctx.canvas.height - y, Math.ceil(radius * 2));
  if (w <= 0 || h <= 0) return;
  const block = Math.max(4, Math.round(blockSize));
  const data = ctx.getImageData(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let py = by; py < Math.min(by + block, h); py++) {
        for (let px = bx; px < Math.min(bx + block, w); px++) {
          const i = (py * w + px) * 4;
          r += data.data[i];
          g += data.data[i + 1];
          b += data.data[i + 2];
          count++;
        }
      }
      if (!count) continue;
      ctx.fillStyle = 'rgb(' + Math.round(r / count) + ',' + Math.round(g / count) + ',' + Math.round(b / count) + ')';
      ctx.fillRect(x + bx, y + by, Math.min(block, w - bx), Math.min(block, h - by));
    }
  }
  ctx.restore();
}
function drawMosaic(ctx, shape, scaleX, scaleY) {
  const points = (shape.points || []).map((p) => scaledPoint(p, scaleX, scaleY));
  if (points.length < 2) return;
  const scale = (scaleX + scaleY) / 2;
  const size = Math.max(8, (shape.size || 32) * scale);
  const sourceBlock = shape.block || Math.max(6, (shape.size || 32) / 3);
  const block = Math.max(4, sourceBlock * scale);
  const step = Math.max(4, size / 3);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    const dist = Math.max(1, Math.hypot(next.x - prev.x, next.y - prev.y));
    const count = Math.max(1, Math.ceil(dist / step));
    for (let j = 0; j <= count; j++) {
      const t = j / count;
      drawMosaicPatch(ctx, prev.x + (next.x - prev.x) * t, prev.y + (next.y - prev.y) * t, size, block);
    }
  }
}
function drawShape(ctx, shape, scaleX, scaleY) {
  if (shape.kind === 'arrow') {
    drawArrow(ctx, shape, scaleX, scaleY);
    return;
  }
  if (shape.kind === 'brush') {
    drawBrush(ctx, shape, scaleX, scaleY);
    return;
  }
  if (shape.kind === 'mosaic') {
    drawMosaic(ctx, shape, scaleX, scaleY);
    return;
  }
  ctx.save();
  ctx.strokeStyle = shape.color || '#ff4d4f';
  ctx.fillStyle = shape.color || '#ff4d4f';
  ctx.lineWidth = Math.max(1, (shape.lineWidth || 4) * ((scaleX + scaleY) / 2));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const x = shape.x * scaleX;
  const y = shape.y * scaleY;
  const width = (shape.width || 0) * scaleX;
  const height = (shape.height || 0) * scaleY;
  if (shape.kind === 'rect') {
    ctx.strokeRect(x, y, width, height);
  } else if (shape.kind === 'circle') {
    ctx.beginPath();
    ctx.ellipse(x + width / 2, y + height / 2, Math.max(0.5, width / 2), Math.max(0.5, height / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape.kind === 'text') {
    ctx.font = Math.max(10, (shape.fontSize || 28) * scaleY) + 'px system-ui,-apple-system,Segoe UI,sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(shape.text || '', x, y);
  }
  ctx.restore();
}
window.__renderAnnotatedCapture = new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(payload.width));
    canvas.height = Math.max(1, Math.round(payload.height));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const scaleX = canvas.width / Math.max(1, payload.sourceWidth);
    const scaleY = canvas.height / Math.max(1, payload.sourceHeight);
    for (const shape of payload.annotations || []) drawShape(ctx, shape, scaleX, scaleY);
    resolve(canvas.toDataURL('image/png'));
  };
  img.onerror = () => reject(new Error('标注合成失败'));
  img.src = payload.imageDataUrl;
});
</script>
</body>
</html>`
}

async function renderAnnotatedCapture(shot, annotations, sourceRect) {
  if (!annotations.length) return shot
  const renderWin = new BrowserWindow({
    width: Math.min(1200, Math.max(1, shot.width)),
    height: Math.min(900, Math.max(1, shot.height)),
    frame: false,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  try {
    hardenWebContents(renderWin.webContents)
    const html = annotatedCaptureHtml({
      imageDataUrl: shot.imageDataUrl,
      width: shot.width,
      height: shot.height,
      sourceWidth: sourceRect.width,
      sourceHeight: sourceRect.height,
      annotations,
    })
    await renderWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const imageDataUrl = await renderWin.webContents.executeJavaScript('window.__renderAnnotatedCapture', true)
    const img = dataUrlImage(imageDataUrl)
    const size = img.getSize()
    return { imageDataUrl, width: size.width, height: size.height }
  } finally {
    if (!renderWin.isDestroyed()) renderWin.destroy()
  }
}

function deliverCaptureToEditor(payload) {
  pendingCaptures.push(payload)
  openToolInMain(SCREENSHOT_TOOL_ID)
  sendToMain('screenshot:capture', payload)
}

function captureToastDisplay(displayId) {
  const displays = screen.getAllDisplays()
  return displays.find((d) => d.id === displayId)
    || screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    || screen.getPrimaryDisplay()
}

function captureToastBounds(displayId) {
  const display = captureToastDisplay(displayId)
  const wa = display.workArea
  const width = Math.min(320, Math.max(240, 280))
  const height = 108
  const margin = 16
  return {
    x: clamp(Math.round(wa.x + wa.width - width - margin), wa.x + 8, wa.x + wa.width - width - 8),
    y: clamp(Math.round(wa.y + wa.height - height - margin), wa.y + 8, wa.y + wa.height - height - 8),
    width,
    height,
  }
}

function captureToastHtml(toast) {
  const id = JSON.stringify(toast.id)
  const image = JSON.stringify(toast.capture.imageDataUrl)
  const dimensions = JSON.stringify(`${toast.capture.width} × ${toast.capture.height}px`)
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>截图已完成</title>
<style>
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; font-family: system-ui,-apple-system,Segoe UI,sans-serif; }
body { color: #f7fafc; }
.toast { position: fixed; inset: 0; border-radius: 12px; overflow: hidden; background: rgba(17, 22, 31, .94); border: 1px solid rgba(255,255,255,.18); box-shadow: 0 18px 48px rgba(0,0,0,.34); }
#open { all: unset; box-sizing: border-box; position: absolute; inset: 0; display: grid; grid-template-columns: 96px minmax(0,1fr); gap: 12px; align-items: center; padding: 12px 42px 12px 12px; cursor: pointer; }
#open:focus-visible { outline: 2px solid #35d5c7; outline-offset: -4px; }
img { width: 96px; height: 68px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.08); }
.copy { min-width: 0; display: grid; gap: 5px; }
.title { font-size: 14px; font-weight: 720; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta { color: rgba(247,250,252,.74); font-size: 12px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#close { position: absolute; right: 8px; top: 8px; width: 26px; height: 26px; border: 0; border-radius: 7px; color: rgba(247,250,252,.88); background: rgba(255,255,255,.12); cursor: pointer; font-size: 16px; line-height: 1; }
#close:hover, #close:focus-visible { background: rgba(255,255,255,.2); outline: none; }
</style>
</head>
<body>
<div class="toast">
  <button id="open" aria-label="打开截图标注编辑器">
    <img id="thumb" alt="" draggable="false" />
    <span class="copy">
      <span class="title">截图已完成</span>
      <span class="meta" id="dimensions"></span>
      <span class="meta">点击标注</span>
    </span>
  </button>
  <button id="close" aria-label="关闭截图完成浮窗">×</button>
</div>
<script>
const TOAST_ID = ${id};
const IMAGE_DATA_URL = ${image};
const DIMENSIONS = ${dimensions};
let timer = null;
function bridge() { return window.ttool && window.ttool.screenshot; }
function clearTimer() {
  if (timer) window.clearTimeout(timer);
  timer = null;
}
function armTimer() {
  clearTimer();
  timer = window.setTimeout(() => {
    const api = bridge();
    if (api && api.closeCaptureToast) api.closeCaptureToast(TOAST_ID);
  }, 5000);
}
function openEditor() {
  clearTimer();
  const api = bridge();
  if (api && api.openCaptureToast) api.openCaptureToast(TOAST_ID);
}
function closeToast() {
  clearTimer();
  const api = bridge();
  if (api && api.closeCaptureToast) api.closeCaptureToast(TOAST_ID);
}
function isCloseTarget(target) {
  return Boolean(target && target.closest && target.closest('#close'));
}
document.getElementById('thumb').src = IMAGE_DATA_URL;
document.getElementById('dimensions').textContent = DIMENSIONS;
document.getElementById('open').addEventListener('click', openEditor);
document.getElementById('close').addEventListener('click', (e) => {
  e.stopPropagation();
  closeToast();
});
window.addEventListener('mouseenter', clearTimer);
window.addEventListener('mouseleave', armTimer);
window.addEventListener('focusin', clearTimer);
window.addEventListener('focusout', armTimer);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeToast();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (isCloseTarget(e.target)) closeToast();
    else openEditor();
  }
});
armTimer();
</script>
</body>
</html>`
}

function closeCaptureToast(id) {
  if (!captureToast) return { ok: true }
  if (id && captureToast.id !== String(id)) return { ok: true }
  const toast = captureToast
  captureToast = null
  try {
    if (toast.window && !toast.window.isDestroyed()) toast.window.close()
  } catch {
    /* ignore */
  }
  return { ok: true }
}

function openCaptureToast(id) {
  if (!captureToast || captureToast.id !== String(id || '')) return { ok: false, error: '截图浮窗已失效' }
  const capture = { ...captureToast.capture }
  closeCaptureToast(captureToast.id)
  deliverCaptureToEditor(capture)
  return { ok: true }
}

function createCaptureToast(capture, options = {}) {
  closeCaptureToast()
  const id = 'toast_' + Date.now().toString(36) + '_' + (++toastSeq).toString(36)
  const bounds = captureToastBounds(options.displayId)
  const toast = { id, capture: { ...capture }, window: null }
  const toastWin = new BrowserWindow({
    ...bounds,
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
    focusable: true,
    hasShadow: true,
    show: false,
    title: '截图已完成',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  toast.window = toastWin
  captureToast = toast
  toastWin.setAlwaysOnTop(true, 'screen-saver')
  hardenWebContents(toastWin.webContents)
  toastWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(captureToastHtml(toast)))
  toastWin.once('ready-to-show', () => {
    if (!toastWin.isDestroyed()) toastWin.showInactive()
  })
  toastWin.on('closed', () => {
    if (captureToast && captureToast.id === id) captureToast = null
  })
  return { ok: true, id }
}

function recentScreenshotList() {
  return recentScreenshots.map((item) => ({ ...item }))
}

function emitRecentScreenshotsChanged() {
  if (!win || win.isDestroyed()) return
  const send = () => {
    if (win && !win.isDestroyed()) win.webContents.send('screenshot:recents-changed', recentScreenshotList())
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

function rememberScreenshot(dataUrl, options = {}) {
  try {
    const img = dataUrlImage(dataUrl)
    const size = img.getSize()
    const item = {
      id: 'recent_' + Date.now().toString(36) + '_' + (++recentSeq).toString(36),
      imageDataUrl: String(dataUrl || ''),
      createdAt: Date.now(),
      width: size.width,
      height: size.height,
      displayId: options && options.displayId !== undefined ? Number(options.displayId) : undefined,
    }
    recentScreenshots.unshift(item)
    while (recentScreenshots.length > RECENT_SCREENSHOT_LIMIT) recentScreenshots.pop()
    emitRecentScreenshotsChanged()
    return { ok: true, item: { ...item } }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : '图片数据无效' }
  }
}

function deleteRecentScreenshot(id) {
  const index = recentScreenshots.findIndex((item) => item.id === String(id || ''))
  if (index >= 0) {
    recentScreenshots.splice(index, 1)
    emitRecentScreenshotsChanged()
  }
  return { ok: true }
}

function normalizeOverlayAction(requested, defaultAction) {
  if (requested === 'edit' || requested === 'pin' || requested === 'copy' || requested === 'save') return requested
  return defaultAction === 'pin' ? 'pin' : 'edit'
}

async function completeOverlaySelection(payload) {
  if (!activeCapture || payload.captureId !== activeCapture.id) return { ok: false, error: '截图已取消' }
  const capture = activeCapture
  const display = capture.displays.find((d) => d.id === Number(payload.displayId))
  if (!display) return { ok: false, error: '未检测到可用显示器' }
  const rect = {
    x: Math.round(Number(payload.rect && payload.rect.x) || 0),
    y: Math.round(Number(payload.rect && payload.rect.y) || 0),
    width: Math.round(Number(payload.rect && payload.rect.width) || 0),
    height: Math.round(Number(payload.rect && payload.rect.height) || 0),
  }
  if (rect.width < 8 || rect.height < 8) {
    closeActiveOverlayWindows()
    activeCapture = null
    emitScreenshotStatus('error', '选区过小')
    return { ok: false, error: '选区过小' }
  }
  const action = normalizeOverlayAction(payload.action, capture.action)
  const annotations = normalizeOverlayAnnotations(payload.annotations, rect)
  const frozenFrame = capture.frozenFrames.get(String(display.id))
  closeActiveOverlayWindows()
  activeCapture = null
  try {
    let shot = cropFrozenDisplayRegion(frozenFrame, display, rect)
    shot = await renderAnnotatedCapture(shot, annotations, rect)
    rememberScreenshot(shot.imageDataUrl, { displayId: display.id })
    if (action === 'pin') {
      const result = createPinWindow(shot.imageDataUrl, { displayId: display.id, sourceRect: rect })
      emitScreenshotStatus(result.ok ? 'info' : 'error', result.ok ? '已创建贴图' : result.error || '截图失败，请重试')
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    }
    if (action === 'copy') {
      const result = copyImageToClipboard(shot.imageDataUrl)
      emitScreenshotStatus(result.ok ? 'info' : 'error', result.ok ? '图片已复制' : result.error || '复制失败')
      return result
    }
    if (action === 'save') {
      const result = await saveImageToFile(shot.imageDataUrl, 'ttool-screenshot.png')
      if (!result.canceled) emitScreenshotStatus(result.ok ? 'info' : 'error', result.ok ? '图片已保存' : result.error || '保存失败')
      return result.ok || result.canceled ? { ok: true, canceled: result.canceled } : { ok: false, error: result.error }
    }
    const result = copyImageToClipboard(shot.imageDataUrl)
    emitScreenshotStatus(result.ok ? 'info' : 'error', result.ok ? '图片已复制' : result.error || '复制失败')
    return result
  } catch (e) {
    const msg = e && e.message ? e.message : '截图失败，请重试'
    emitScreenshotStatus('error', msg)
    return { ok: false, error: msg }
  }
}

function cancelOverlaySelection(reason) {
  if (!activeCapture) return { ok: true }
  closeActiveOverlayWindows()
  activeCapture = null
  const msg = reason || '截图已取消'
  emitScreenshotStatus(msg === '截图已取消' ? 'info' : 'error', msg)
  return { ok: true }
}

function dataUrlImage(dataUrl) {
  const img = nativeImage.createFromDataURL(String(dataUrl || ''))
  if (!img || img.isEmpty()) throw new Error('图片数据无效')
  return img
}

function pinInfo(pin) {
  return {
    id: pin.id,
    imageDataUrl: pin.imageDataUrl,
    createdAt: pin.createdAt,
    width: pin.width,
    height: pin.height,
    visible: pin.visible,
    displayId: pin.displayId,
    opacity: pin.opacity,
  }
}

function pinList() {
  return [...pins.values()].map(pinInfo).sort((a, b) => b.createdAt - a.createdAt)
}

function broadcastPins() {
  const list = pinList()
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      if (!w.isDestroyed()) w.webContents.send('screenshot:pins-changed', list)
    } catch {
      /* ignore */
    }
  }
}

function pinBounds(width, height, options = {}) {
  const display = screen.getAllDisplays().find((d) => d.id === options.displayId) || screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  const maxW = Math.min(900, Math.floor(wa.width * 0.4))
  const maxH = Math.min(700, Math.floor(wa.height * 0.4))
  const maxScale = Math.max(0.1, Math.min(maxW / width, maxH / height))
  const minScale = Math.max(180 / width, 120 / height)
  const scale = Math.min(maxScale, Math.max(Math.min(1, maxScale), minScale))
  const w = Math.max(120, Math.round(width * scale))
  const h = Math.max(90, Math.round(height * scale))
  let x = Math.round(wa.x + (wa.width - w) / 2)
  let y = Math.round(wa.y + (wa.height - h) / 2)
  if (options.sourceRect) {
    const r = options.sourceRect
    x = display.bounds.x + r.x + r.width + 16
    y = display.bounds.y + r.y
    if (x + w > wa.x + wa.width) x = display.bounds.x + r.x - w - 16
  }
  x = clamp(Math.round(x), wa.x + 8, wa.x + wa.width - w - 8)
  y = clamp(Math.round(y), wa.y + 8, wa.y + wa.height - h - 8)
  return { x, y, width: w, height: h }
}

function pinHtml(pin) {
  const id = JSON.stringify(pin.id)
  const image = JSON.stringify(pin.imageDataUrl)
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; font-family: system-ui,-apple-system,Segoe UI,sans-serif; }
body { border-radius: 10px; }
.frame { position: fixed; inset: 0; overflow: hidden; border-radius: 10px; border: 1px solid rgba(255,255,255,.24); background: rgba(20,22,28,.18); box-shadow: 0 14px 44px rgba(0,0,0,.32); -webkit-app-region: drag; }
img { width: 100%; height: 100%; object-fit: contain; display: block; }
.toolbar { position: absolute; right: 8px; top: 8px; display: flex; gap: 5px; padding: 5px; border-radius: 9px; background: rgba(15,18,24,.78); opacity: 0; transition: opacity .14s ease; -webkit-app-region: no-drag; }
.frame:hover .toolbar, .toolbar:focus-within, body.showbar .toolbar { opacity: 1; }
button { height: 28px; border: 0; border-radius: 7px; padding: 0 8px; color: #fff; background: rgba(255,255,255,.16); font-size: 12px; cursor: pointer; }
.hl { box-shadow: 0 0 0 3px #35d5c7 inset, 0 0 28px rgba(53,213,199,.55) inset; }
</style>
</head>
<body>
<div class="frame" id="frame">
  <img id="img" draggable="false" />
  <div class="toolbar">
    <button id="annotate">标注</button><button id="copy">复制</button><button id="save">保存</button><button id="hide">隐藏</button><button id="close">关闭</button>
  </div>
</div>
<script>
const PIN_ID = ${id};
let imageDataUrl = ${image};
const img = document.getElementById('img');
img.src = imageDataUrl;
document.getElementById('annotate').onclick = () => window.ttool.screenshot.annotatePin(PIN_ID);
document.getElementById('copy').onclick = () => window.ttool.screenshot.copyImage(imageDataUrl);
document.getElementById('save').onclick = () => window.ttool.screenshot.saveImage(imageDataUrl, 'ttool-pin.png');
document.getElementById('hide').onclick = () => window.ttool.screenshot.setPinVisible(PIN_ID, false);
document.getElementById('close').onclick = () => window.ttool.screenshot.closePin(PIN_ID);
window.__setPinImage = (next) => { imageDataUrl = next; img.src = next; };
window.__highlightPin = () => {
  document.getElementById('frame').classList.add('hl');
  setTimeout(() => document.getElementById('frame').classList.remove('hl'), 900);
};
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.ttool.screenshot.setPinVisible(PIN_ID, false);
});
</script>
</body>
</html>`
}

function createPinWindow(dataUrl, options = {}) {
  let img
  try {
    img = dataUrlImage(dataUrl)
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : '图片数据无效' }
  }
  const size = img.getSize()
  const id = 'pin_' + Date.now().toString(36) + '_' + (++pinSeq).toString(36)
  const bounds = pinBounds(size.width, size.height, options)
  const pin = {
    id,
    imageDataUrl: dataUrl,
    createdAt: Date.now(),
    width: size.width,
    height: size.height,
    displayId: options.displayId,
    opacity: 1,
    visible: true,
    window: null,
  }
  const pinWin = new BrowserWindow({
    ...bounds,
    minWidth: 180,
    minHeight: 120,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    show: false,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  pin.window = pinWin
  pins.set(id, pin)
  pinWin.setAlwaysOnTop(true, 'screen-saver')
  pinWin.setAspectRatio(size.width / size.height)
  pinWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pinHtml(pin)))
  pinWin.once('ready-to-show', () => pinWin.show())
  pinWin.on('closed', () => {
    pins.delete(id)
    broadcastPins()
  })
  broadcastPins()
  return { ok: true, pin: pinInfo(pin) }
}

function updatePinImage(id, dataUrl) {
  const pin = pins.get(String(id || ''))
  if (!pin) return { ok: false, error: '贴图不存在' }
  let img
  try {
    img = dataUrlImage(dataUrl)
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : '图片数据无效' }
  }
  const size = img.getSize()
  pin.imageDataUrl = dataUrl
  pin.width = size.width
  pin.height = size.height
  try {
    if (!pin.window.isDestroyed()) {
      pin.window.setAspectRatio(size.width / size.height)
      pin.window.webContents.executeJavaScript(`window.__setPinImage(${JSON.stringify(dataUrl)})`).catch(() => {})
    }
  } catch {
    /* ignore */
  }
  broadcastPins()
  return { ok: true, pin: pinInfo(pin) }
}

function focusPin(id) {
  const pin = pins.get(String(id || ''))
  if (!pin || pin.window.isDestroyed()) return { ok: false, error: '贴图不存在' }
  pin.visible = true
  pin.window.show()
  pin.window.moveTop()
  pin.window.focus()
  pin.window.webContents.executeJavaScript('window.__highlightPin && window.__highlightPin()').catch(() => {})
  broadcastPins()
  return { ok: true }
}

function setPinVisible(id, visible) {
  const pin = pins.get(String(id || ''))
  if (!pin || pin.window.isDestroyed()) return { ok: false, error: '贴图不存在' }
  pin.visible = Boolean(visible)
  if (pin.visible) {
    pin.window.show()
    pin.window.moveTop()
  } else {
    pin.window.hide()
  }
  broadcastPins()
  return { ok: true }
}

function closePin(id) {
  const pin = pins.get(String(id || ''))
  if (!pin || pin.window.isDestroyed()) return { ok: false, error: '贴图不存在' }
  pin.window.close()
  return { ok: true }
}

function closeAllPins() {
  for (const pin of [...pins.values()]) {
    try {
      if (!pin.window.isDestroyed()) pin.window.close()
    } catch {
      /* ignore */
    }
  }
  return { ok: true }
}

function annotatePin(id) {
  const pin = pins.get(String(id || ''))
  if (!pin) return { ok: false, error: '贴图不存在' }
  deliverCaptureToEditor({
    id: 'pin_edit_' + Date.now().toString(36),
    source: 'pin-annotate',
    pinId: pin.id,
    imageDataUrl: pin.imageDataUrl,
    width: pin.width,
    height: pin.height,
    createdAt: Date.now(),
    displayId: pin.displayId,
  })
  return { ok: true }
}

function copyImageToClipboard(dataUrl) {
  try {
    clipboard.writeImage(dataUrlImage(dataUrl))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : '复制失败' }
  }
}

async function saveImageToFile(dataUrl, suggestedName) {
  let img
  try {
    img = dataUrlImage(dataUrl)
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : '图片数据无效' }
  }
  const res = await dialog.showSaveDialog(win || undefined, {
    title: '保存截图',
    defaultPath: suggestedName || ('ttool-screenshot-' + Date.now() + '.png'),
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  })
  if (res.canceled || !res.filePath) return { ok: false, canceled: true }
  try {
    fs.writeFileSync(res.filePath, img.toPNG())
    return { ok: true, path: res.filePath }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : '保存失败' }
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
    icon: APP_ICON,
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

  win.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    void requestMainWindowClose()
  })

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

// ---- IPC：Codex 用量状态（仅 first-party 内置工具使用） ----
ipcMain.handle('codex-usage:getState', () => openCodexUsageForToolPage())
ipcMain.handle('codex-usage:refresh', async () => {
  await getCodexUsageService().refresh()
  return codexUsageState()
})
ipcMain.handle('codex-usage:setEnabled', (_e, { enabled }) => setCodexUsageEnabled(enabled))
ipcMain.handle('codex-usage:setWidgetOpacity', (_e, { opacity }) => setCodexUsageWidgetOpacity(opacity))
ipcMain.handle('codex-usage:showWidget', () => showCodexUsageWidget())
ipcMain.handle('codex-usage:hideWidget', () => {
  destroyCodexUsageWidget()
  return releaseCodexUsageFromToolPage()
})
ipcMain.handle('codex-usage:release', () => releaseCodexUsageFromToolPage())

// ---- IPC：截图贴图 ----
ipcMain.handle('screenshot:environment', () => screenshotEnvironment())
ipcMain.handle('screenshot:getConfig', () => ({ ok: true, config: screenshotShortcutConfig, statuses: screenshotShortcutStatuses }))
ipcMain.handle('screenshot:setConfig', (_e, config) => setScreenshotConfig(config))
ipcMain.handle('screenshot:startCapture', (_e, { action }) => startScreenshotCapture(action === 'pin' ? 'pin' : 'edit'))
ipcMain.handle('screenshot:consumeCaptures', () => {
  const items = pendingCaptures.splice(0, pendingCaptures.length)
  return items
})
ipcMain.handle('screenshot:ackCapture', (_e, { id }) => {
  const i = pendingCaptures.findIndex((c) => c.id === id)
  if (i >= 0) pendingCaptures.splice(i, 1)
  return { ok: true }
})
ipcMain.handle('screenshot:listRecentScreenshots', () => recentScreenshotList())
ipcMain.handle('screenshot:rememberScreenshot', (_e, { dataUrl, options }) => rememberScreenshot(dataUrl, options || {}))
ipcMain.handle('screenshot:deleteRecentScreenshot', (_e, { id }) => deleteRecentScreenshot(id))
ipcMain.handle('screenshot:overlaySelect', (_e, payload) => completeOverlaySelection(payload || {}))
ipcMain.handle('screenshot:overlayCancel', (_e, payload) => cancelOverlaySelection(payload && payload.reason))
ipcMain.handle('screenshot:copyImage', (_e, { dataUrl }) => copyImageToClipboard(dataUrl))
ipcMain.handle('screenshot:saveImage', (_e, { dataUrl, suggestedName }) => saveImageToFile(dataUrl, suggestedName))
ipcMain.handle('screenshot:listPins', () => pinList())
ipcMain.handle('screenshot:createPin', (_e, { dataUrl, options }) => createPinWindow(dataUrl, options || {}))
ipcMain.handle('screenshot:updatePin', (_e, { id, dataUrl }) => updatePinImage(id, dataUrl))
ipcMain.handle('screenshot:focusPin', (_e, { id }) => focusPin(id))
ipcMain.handle('screenshot:setPinVisible', (_e, { id, visible }) => setPinVisible(id, visible))
ipcMain.handle('screenshot:closePin', (_e, { id }) => closePin(id))
ipcMain.handle('screenshot:closeAllPins', () => closeAllPins())
ipcMain.handle('screenshot:annotatePin', (_e, { id }) => annotatePin(id))
ipcMain.handle('screenshot:openCaptureToast', (_e, { id }) => openCaptureToast(id))
ipcMain.handle('screenshot:closeCaptureToast', (_e, { id }) => closeCaptureToast(id))

// ---- 快速启动器小窗（Spotlight 式）：无边框 / 透明 / 置顶 / 不占任务栏 / 动态高度 ----
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
  // 用上次量好的内容高度直接显示（启动时已按 recents 内容算好）。
  // 不要在这里把高度重置成 72：召唤空查询时渲染层不一定会重新上报高度，会把窗口卡在 72px、
  // 下面的最近工具被裁掉，直到用户输入文字才长开——正是「输入后才正常」的成因。
  positionLauncher()
  // 只聚焦 launcher 本身：绝不用 app.focus()——它在 Windows 上聚焦「应用第一个窗口」=主窗，
  // 会把主窗顶到前台（表现为按 Alt+Space 弹出的是主窗而非小窗）。
  launcher.show()
  launcher.moveTop()
  launcher.focus()
  try { launcher.webContents.invalidate() } catch { /* 强制重绘，规避透明窗显示旧帧 */ }
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
// 深度扫描所有已就绪盘符（较慢，渲染层与索引结果并行调用、稍后合并）
ipcMain.handle('files:searchDeep', async (_e, { query }) => {
  try {
    return await searchDeep(query)
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
ipcMain.handle('win:close', () => requestMainWindowClose())

app.whenReady().then(() => {
  setupPlugins({ ipcMain, app, dialog, getWin: () => win })
  // 宿主能力：通用 net（TCP/TLS）+ 按插件命名空间的 storage + safeStorage 加密 secrets
  host = setupHost({ ipcMain, app, getWin: () => win })
  updaterHost = setupUpdater({
    app,
    ipcMain,
    dialog,
    getWin: () => win,
    markQuitting: () => { isQuitting = true },
  })
  createWindow()
  createTray()
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
  initializeScreenshotShortcuts()
  initializeCodexUsage()
  app.on('activate', () => {
    if (!win || win.isDestroyed()) createWindow()
    else showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  // 常驻悬浮窗不应阻塞退出事件；先销毁它并停止按需启动的 App Server。
  disposeCodexUsage()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (updaterHost) {
    updaterHost.dispose()
    updaterHost = null
  }
  if (tray) {
    tray.destroy()
    tray = null
  }
  if (host) host.closeAll() // 回收全部 net 连接并停掉 idle 扫描
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
