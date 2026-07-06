// Electron 主进程：创建无边框毛玻璃窗口，并通过 IPC 暴露桌面能力
// （剪贴板、打开第三方应用、选择应用路径、窗口控制）。
// 设计为可选壳层——核心 React 应用在浏览器中也能独立运行（见 src/platform）。
const { app, BrowserWindow, ipcMain, clipboard, shell, dialog, globalShortcut, screen, desktopCapturer, nativeImage, systemPreferences } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const { setupPlugins } = require('./plugins.cjs')
const { setupHost } = require('./host/index.cjs')
const { searchFiles, searchDeep } = require('./filesearch.cjs')

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; cursor: crosshair; user-select: none; font-family: system-ui,-apple-system,Segoe UI,sans-serif; }
#dim { position: fixed; inset: 0; background: rgba(0,0,0,.48); pointer-events: none; }
body.has-selection #dim { background: transparent; }
#sel { position: absolute; display: none; border: 2px solid #35d5c7; background: rgba(53,213,199,.04); box-shadow: 0 0 0 9999px rgba(0,0,0,.46), 0 0 0 1px rgba(255,255,255,.78) inset, 0 0 0 1px rgba(53,213,199,.25); box-sizing: border-box; cursor: default; }
#sel.invalid { border-color: #ff6b6b; background: rgba(255,107,107,.06); box-shadow: 0 0 0 9999px rgba(0,0,0,.48), 0 0 0 1px rgba(255,255,255,.72) inset, 0 0 0 1px rgba(255,107,107,.35); }
#chip { position: absolute; transform: translateY(calc(-100% - 7px)); padding: 4px 8px; border-radius: 8px; background: rgba(15,18,24,.92); color: #fff; font-size: 12px; line-height: 1.2; white-space: nowrap; box-shadow: 0 5px 16px rgba(0,0,0,.24); pointer-events: none; }
#sel.invalid #chip { background: rgba(92,20,25,.95); }
.handle { position: absolute; width: 9px; height: 9px; border-radius: 3px; background: #35d5c7; border: 1px solid rgba(255,255,255,.95); box-shadow: 0 2px 6px rgba(0,0,0,.28); box-sizing: border-box; }
#sel.invalid .handle { background: #ff6b6b; }
#bar { position: absolute; display: none; align-items: center; flex-wrap: wrap; gap: 6px; max-width: calc(100vw - 16px); padding: 7px; border-radius: 11px; background: rgba(15,18,24,.94); box-shadow: 0 10px 30px rgba(0,0,0,.34); cursor: default; }
.sep { width: 1px; height: 20px; background: rgba(255,255,255,.18); margin: 0 2px; }
button { height: 32px; min-width: 42px; border: 0; border-radius: 8px; padding: 0 11px; color: #fff; background: rgba(255,255,255,.15); font-size: 12px; font-weight: 650; cursor: pointer; }
button:hover:not(:disabled) { background: rgba(255,255,255,.22); }
button.primary { background: #1ba99a; }
button.primary:hover:not(:disabled) { background: #22bfae; }
button.danger { color: #ffb1b1; }
button:disabled { opacity: .42; cursor: not-allowed; }
#hint { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); padding: 8px 12px; border-radius: 10px; color: #fff; background: rgba(15,18,24,.76); font-size: 12px; pointer-events: none; }
</style>
</head>
<body>
<div id="dim"></div>
<div id="hint">拖拽选择区域，Esc 取消</div>
<div id="sel"><div id="chip"></div></div>
<div id="bar">
  <button data-action="copy">复制</button>
  <button data-action="save">保存</button>
  <button data-action="pin">贴图</button>
  <span class="sep"></span>
  <button class="danger" id="cancel">取消</button>
  <button class="primary" data-action="default">✓</button>
</div>
<script>
const META = ${meta};
const MIN = 8;
let start = null;
let rect = null;
let selecting = false;
let completed = false;
let pendingInsideClick = false;
let downPoint = null;
let movedSinceDown = false;
const sel = document.getElementById('sel');
const chip = document.getElementById('chip');
const bar = document.getElementById('bar');
const hint = document.getElementById('hint');
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function pointInRect(p, r) { return Boolean(r && p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height); }
function isInteractive(target) { return Boolean(target.closest && target.closest('button, #bar, .handle, #chip')); }
function isValid() { return Boolean(rect && rect.width >= MIN && rect.height >= MIN); }
let sending = false;
function updateButtons() {
  const valid = isValid();
  sel.classList.toggle('invalid', Boolean(rect) && !valid);
  chip.textContent = valid || !rect ? (rect ? rect.width + ' × ' + rect.height : '') : '选区过小';
  bar.querySelectorAll('button[data-action]').forEach((btn) => { btn.disabled = !valid || sending; });
  document.getElementById('cancel').disabled = sending;
}
function showBridgeError(message) {
  sending = false;
  hint.textContent = message || '截图失败，请重试';
  hint.style.background = 'rgba(92,20,25,.92)';
  updateButtons();
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
  updateButtons();
  positionChip();
  renderHandles();
}
function renderHandles() {
  sel.querySelectorAll('.handle').forEach((n) => n.remove());
  const pos = [[0,0],[50,0],[100,0],[0,50],[100,50],[0,100],[50,100],[100,100]];
  for (const p of pos) {
    const h = document.createElement('i');
    h.className = 'handle';
    h.style.left = 'calc(' + p[0] + '% - 4.5px)';
    h.style.top = 'calc(' + p[1] + '% - 4.5px)';
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
  completed = false;
  pendingInsideClick = false;
  bar.style.display = 'none';
  start = p;
  setRect({ x: start.x, y: start.y, width: 0, height: 0 });
}
function updateSelection(p) {
  const x = Math.min(start.x, p.x);
  const y = Math.min(start.y, p.y);
  setRect({ x, y, width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) });
}
function submit(action) {
  if (!isValid()) {
    updateButtons();
    return;
  }
  const resolved = action === 'default' ? META.defaultAction : action;
  sendOverlay('select', { captureId: META.captureId, displayId: META.displayId, rect, action: resolved });
}
window.addEventListener('mousedown', (e) => {
  if (isInteractive(e.target)) return;
  const p = { x: e.clientX, y: e.clientY };
  downPoint = p;
  movedSinceDown = false;
  if (completed && isValid() && pointInRect(p, rect)) {
    pendingInsideClick = true;
    return;
  }
  beginSelection(p);
});
window.addEventListener('mousemove', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  if (downPoint && Math.hypot(p.x - downPoint.x, p.y - downPoint.y) > 4) movedSinceDown = true;
  if (pendingInsideClick && movedSinceDown && downPoint) beginSelection(downPoint);
  if (!selecting || !start) return;
  updateSelection(p);
});
window.addEventListener('mouseup', () => {
  if (pendingInsideClick) {
    pendingInsideClick = false;
    return;
  }
  if (!selecting) return;
  selecting = false;
  completed = true;
  updateBar();
});
window.addEventListener('dblclick', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  if (isInteractive(e.target) || movedSinceDown || selecting || !completed || !isValid() || !pointInRect(p, rect)) return;
  submit('default');
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') sendOverlay('cancel', { captureId: META.captureId, reason: '截图已取消' });
});
document.getElementById('cancel').onclick = () => sendOverlay('cancel', { captureId: META.captureId, reason: '截图已取消' });
bar.querySelectorAll('button[data-action]').forEach((btn) => {
  btn.onclick = () => submit(btn.getAttribute('data-action'));
});
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

function createOverlayWindow(captureId, display, action) {
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
  overlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(overlayHtml(captureId, display, action)))
  overlay.show()
  overlay.focus()
  return overlay
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
    activeCapture = { id: captureId, action, windows: [], displays }
    activeCapture.windows = displays.map((d) => createOverlayWindow(captureId, d, action))
    return { ok: true }
  } catch (e) {
    closeActiveOverlayWindows()
    activeCapture = null
    const msg = e && e.message ? e.message : '截图失败，请重试'
    emitScreenshotStatus('error', msg)
    return { ok: false, error: msg }
  }
}

async function captureDisplayRegion(display, rect) {
  const thumbWidth = Math.max(1, Math.round(display.bounds.width * (display.scaleFactor || 1)))
  const thumbHeight = Math.max(1, Math.round(display.bounds.height * (display.scaleFactor || 1)))
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: thumbWidth, height: thumbHeight } })
  const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0]
  if (!source || source.thumbnail.isEmpty()) throw new Error('截图失败，请重试')
  const img = source.thumbnail
  const size = img.getSize()
  const sx = size.width / display.bounds.width
  const sy = size.height / display.bounds.height
  const crop = {
    x: clamp(Math.round(rect.x * sx), 0, Math.max(0, size.width - 1)),
    y: clamp(Math.round(rect.y * sy), 0, Math.max(0, size.height - 1)),
    width: clamp(Math.round(rect.width * sx), 1, size.width),
    height: clamp(Math.round(rect.height * sy), 1, size.height),
  }
  crop.width = Math.min(crop.width, size.width - crop.x)
  crop.height = Math.min(crop.height, size.height - crop.y)
  const cropped = img.crop(crop)
  const croppedSize = cropped.getSize()
  return { imageDataUrl: cropped.toDataURL(), width: croppedSize.width, height: croppedSize.height }
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
  const display = activeCapture.displays.find((d) => d.id === Number(payload.displayId))
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
  const action = normalizeOverlayAction(payload.action, activeCapture.action)
  closeActiveOverlayWindows()
  activeCapture = null
  try {
    await sleep(90)
    const shot = await captureDisplayRegion(display, rect)
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
    const capture = {
      id: 'shot_' + Date.now().toString(36),
      source: 'screenshot',
      imageDataUrl: shot.imageDataUrl,
      width: shot.width,
      height: shot.height,
      createdAt: Date.now(),
      displayId: display.id,
    }
    const copyResult = copyImageToClipboard(shot.imageDataUrl)
    if (!copyResult.ok) console.warn('[screenshot] copy captured image to clipboard failed:', copyResult.error || 'unknown error')
    createCaptureToast(capture, { displayId: display.id })
    emitScreenshotStatus(copyResult.ok ? 'info' : 'error', copyResult.ok ? '截图已完成，已复制到剪贴板' : '截图已完成，复制到剪贴板失败')
    return { ok: true }
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
// 深度扫描其它固定硬盘（较慢，渲染层与索引结果并行调用、稍后合并）
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
  initializeScreenshotShortcuts()
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
