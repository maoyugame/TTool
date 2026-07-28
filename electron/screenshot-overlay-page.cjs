'use strict'

const { overlayFrameReceiverScript } = require('./screenshot-overlay-frame.cjs')

const OVERLAY_SELECTION_CONTRACT = Object.freeze({
  version: 'overlay-css-px-v1',
  selectFields: Object.freeze([
    'captureId',
    'displayId',
    'rect',
    'viewport',
    'renderedImageRect',
    'frameSize',
    'coordinateSpace',
    'action',
    'annotations',
  ]),
  cancelFields: Object.freeze(['captureId', 'reason']),
})

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positiveNumber(value, fallback = 1) {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  const fallbackValue = Number(fallback)
  return Number.isFinite(fallbackValue) && fallbackValue > 0 ? fallbackValue : 1
}

function normalizeOverlayViewport(viewport) {
  return {
    width: Math.max(1, Math.round(positiveNumber(viewport && viewport.width, 1))),
    height: Math.max(1, Math.round(positiveNumber(viewport && viewport.height, 1))),
    devicePixelRatio: positiveNumber(viewport && viewport.devicePixelRatio, 1),
  }
}

function normalizeRenderedImageRect(rect, viewport) {
  const normalizedViewport = normalizeOverlayViewport(viewport)
  return {
    x: finiteNumber(rect && rect.x, 0),
    y: finiteNumber(rect && rect.y, 0),
    width: positiveNumber(rect && rect.width, normalizedViewport.width),
    height: positiveNumber(rect && rect.height, normalizedViewport.height),
  }
}

function normalizeFrameSize(frameSize) {
  return {
    width: Math.max(0, Math.round(finiteNumber(frameSize && frameSize.width, 0))),
    height: Math.max(0, Math.round(finiteNumber(frameSize && frameSize.height, 0))),
  }
}

function normalizeOverlayRect(rect, viewport) {
  const normalizedViewport = normalizeOverlayViewport(viewport)
  const x1 = finiteNumber(rect && rect.x)
  const y1 = finiteNumber(rect && rect.y)
  const x2 = x1 + finiteNumber(rect && rect.width)
  const y2 = y1 + finiteNumber(rect && rect.height)
  const left = clamp(Math.min(x1, x2), 0, normalizedViewport.width)
  const top = clamp(Math.min(y1, y2), 0, normalizedViewport.height)
  const right = clamp(Math.max(x1, x2), left, normalizedViewport.width)
  const bottom = clamp(Math.max(y1, y2), top, normalizedViewport.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function rectFromPoints(first, second) {
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  }
}

function constrainSelectionDrag(start, point, viewport, constrainAspect) {
  const normalizedViewport = normalizeOverlayViewport(viewport)
  const anchor = {
    x: clamp(finiteNumber(start && start.x), 0, normalizedViewport.width),
    y: clamp(finiteNumber(start && start.y), 0, normalizedViewport.height),
  }
  const target = {
    x: clamp(finiteNumber(point && point.x), 0, normalizedViewport.width),
    y: clamp(finiteNumber(point && point.y), 0, normalizedViewport.height),
  }
  if (!constrainAspect) return rectFromPoints(anchor, target)

  const dx = target.x - anchor.x
  const dy = target.y - anchor.y
  const directionX = dx < 0 ? -1 : 1
  const directionY = dy < 0 ? -1 : 1
  const availableX = directionX < 0 ? anchor.x : normalizedViewport.width - anchor.x
  const availableY = directionY < 0 ? anchor.y : normalizedViewport.height - anchor.y
  const side = Math.min(Math.max(Math.abs(dx), Math.abs(dy)), availableX, availableY)
  return rectFromPoints(anchor, {
    x: anchor.x + directionX * side,
    y: anchor.y + directionY * side,
  })
}

function resizeSelectionRect(origin, edge, point, viewport, constrainAspect) {
  const normalizedViewport = normalizeOverlayViewport(viewport)
  const base = normalizeOverlayRect(origin, normalizedViewport)
  const target = {
    x: clamp(finiteNumber(point && point.x), 0, normalizedViewport.width),
    y: clamp(finiteNumber(point && point.y), 0, normalizedViewport.height),
  }
  const handle = String(edge || '')
  if (!handle) return base

  let left = base.x
  let top = base.y
  let right = base.x + base.width
  let bottom = base.y + base.height
  if (handle.includes('w')) left = clamp(target.x, 0, right)
  if (handle.includes('e')) right = clamp(target.x, left, normalizedViewport.width)
  if (handle.includes('n')) top = clamp(target.y, 0, bottom)
  if (handle.includes('s')) bottom = clamp(target.y, top, normalizedViewport.height)
  const unconstrained = { x: left, y: top, width: right - left, height: bottom - top }
  if (!constrainAspect || base.width <= 0 || base.height <= 0) return unconstrained

  const ratio = base.width / base.height
  const horizontal = handle.includes('w') || handle.includes('e')
  const vertical = handle.includes('n') || handle.includes('s')
  const signX = handle.includes('w') ? -1 : 1
  const signY = handle.includes('n') ? -1 : 1

  if (horizontal && vertical) {
    const anchorX = handle.includes('w') ? base.x + base.width : base.x
    const anchorY = handle.includes('n') ? base.y + base.height : base.y
    const candidateWidth = Math.abs(target.x - anchorX)
    const candidateHeight = Math.abs(target.y - anchorY)
    let width = candidateWidth / ratio >= candidateHeight ? candidateWidth : candidateHeight * ratio
    let height = width / ratio
    const availableWidth = signX < 0 ? anchorX : normalizedViewport.width - anchorX
    const availableHeight = signY < 0 ? anchorY : normalizedViewport.height - anchorY
    const scale = Math.min(1, availableWidth / Math.max(width, 1), availableHeight / Math.max(height, 1))
    width *= scale
    height *= scale
    return {
      x: signX < 0 ? anchorX - width : anchorX,
      y: signY < 0 ? anchorY - height : anchorY,
      width,
      height,
    }
  }

  if (horizontal) {
    const anchorX = handle.includes('w') ? base.x + base.width : base.x
    const centerY = base.y + base.height / 2
    let width = Math.abs(target.x - anchorX)
    let height = width / ratio
    const maxHeight = Math.min(centerY * 2, (normalizedViewport.height - centerY) * 2)
    if (height > maxHeight) {
      height = Math.max(0, maxHeight)
      width = height * ratio
    }
    const availableWidth = signX < 0 ? anchorX : normalizedViewport.width - anchorX
    if (width > availableWidth) {
      width = Math.max(0, availableWidth)
      height = width / ratio
    }
    return {
      x: signX < 0 ? anchorX - width : anchorX,
      y: centerY - height / 2,
      width,
      height,
    }
  }

  const anchorY = handle.includes('n') ? base.y + base.height : base.y
  const centerX = base.x + base.width / 2
  let height = Math.abs(target.y - anchorY)
  let width = height * ratio
  const maxWidth = Math.min(centerX * 2, (normalizedViewport.width - centerX) * 2)
  if (width > maxWidth) {
    width = Math.max(0, maxWidth)
    height = width / ratio
  }
  const availableHeight = signY < 0 ? anchorY : normalizedViewport.height - anchorY
  if (height > availableHeight) {
    height = Math.max(0, availableHeight)
    width = height * ratio
  }
  return {
    x: centerX - width / 2,
    y: signY < 0 ? anchorY - height : anchorY,
    width,
    height,
  }
}

function nudgeSelectionRect(rect, key, viewport, step = 1) {
  const normalizedViewport = normalizeOverlayViewport(viewport)
  const normalizedRect = normalizeOverlayRect(rect, normalizedViewport)
  const distance = Math.max(1, Math.round(positiveNumber(step, 1)))
  let dx = 0
  let dy = 0
  if (key === 'ArrowLeft') dx = -distance
  if (key === 'ArrowRight') dx = distance
  if (key === 'ArrowUp') dy = -distance
  if (key === 'ArrowDown') dy = distance
  return {
    x: clamp(normalizedRect.x + dx, 0, Math.max(0, normalizedViewport.width - normalizedRect.width)),
    y: clamp(normalizedRect.y + dy, 0, Math.max(0, normalizedViewport.height - normalizedRect.height)),
    width: normalizedRect.width,
    height: normalizedRect.height,
  }
}

function rgbToHex(red, green, blue) {
  const channel = (value) => Math.round(clamp(finiteNumber(value), 0, 255)).toString(16).padStart(2, '0')
  return '#' + channel(red) + channel(green) + channel(blue)
}

function rgbToHsv(red, green, blue) {
  const r = clamp(finiteNumber(red), 0, 255) / 255
  const g = clamp(finiteNumber(green), 0, 255) / 255
  const b = clamp(finiteNumber(blue), 0, 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let hue = 0
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6)
    else if (max === g) hue = 60 * ((b - r) / delta + 2)
    else hue = 60 * ((r - g) / delta + 4)
  }
  if (hue < 0) hue += 360
  return {
    h: Math.round(hue),
    s: Math.round(max === 0 ? 0 : (delta / max) * 100),
    v: Math.round(max * 100),
  }
}

function formatPixelSample(pixel) {
  const r = Math.round(clamp(finiteNumber(pixel && pixel.r), 0, 255))
  const g = Math.round(clamp(finiteNumber(pixel && pixel.g), 0, 255))
  const b = Math.round(clamp(finiteNumber(pixel && pixel.b), 0, 255))
  const a = Math.round(clamp(finiteNumber(pixel && pixel.a, 255), 0, 255))
  const hsv = rgbToHsv(r, g, b)
  return {
    r,
    g,
    b,
    a,
    hex: rgbToHex(r, g, b),
    rgb: 'rgb(' + r + ', ' + g + ', ' + b + ')',
    hsv: 'hsv(' + hsv.h + '°, ' + hsv.s + '%, ' + hsv.v + '%)',
  }
}

function createOverlayMetrics(viewport, renderedImageRect, frameSize) {
  const normalizedViewport = normalizeOverlayViewport(viewport)
  return {
    viewport: normalizedViewport,
    renderedImageRect: normalizeRenderedImageRect(renderedImageRect, normalizedViewport),
    frameSize: normalizeFrameSize(frameSize),
  }
}

function buildOverlaySelectionPayload(meta, rect, metrics, action, annotations) {
  const normalizedMetrics = createOverlayMetrics(
    metrics && metrics.viewport,
    metrics && metrics.renderedImageRect,
    metrics && metrics.frameSize,
  )
  return {
    captureId: meta && meta.captureId,
    displayId: meta && meta.displayId,
    rect: normalizeOverlayRect(rect, normalizedMetrics.viewport),
    viewport: normalizedMetrics.viewport,
    renderedImageRect: normalizedMetrics.renderedImageRect,
    frameSize: normalizedMetrics.frameSize,
    coordinateSpace: OVERLAY_SELECTION_CONTRACT.version,
    action: action === 'pin' ? 'pin' : action === 'copy' ? 'copy' : action === 'save' ? 'save' : 'edit',
    annotations: Array.isArray(annotations) ? annotations : [],
  }
}

function serializeForInlineScript(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  })[character])
}

function pagePureHelpersScript() {
  return [
    clamp,
    finiteNumber,
    positiveNumber,
    normalizeOverlayViewport,
    normalizeRenderedImageRect,
    normalizeFrameSize,
    normalizeOverlayRect,
    rectFromPoints,
    constrainSelectionDrag,
    resizeSelectionRect,
    nudgeSelectionRect,
    rgbToHex,
    rgbToHsv,
    formatPixelSample,
    createOverlayMetrics,
    buildOverlaySelectionPayload,
  ].map((fn) => fn.toString()).join('\n')
}

function buildScreenshotOverlayPage(captureId, display, action) {
  if (!display || !Object.hasOwn(display, 'id')) throw new TypeError('截图覆盖层需要显示器 id')
  const meta = {
    captureId,
    displayId: display.id,
    defaultAction: action === 'pin' ? 'pin' : 'edit',
  }
  const frameReceiver = overlayFrameReceiverScript()
  const helpers = pagePureHelpersScript()

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
:root { --overlay-bg: #0f1218; --overlay-text: #fff; --overlay-muted: rgba(255,255,255,.72); --overlay-accent: #35d5c7; --overlay-accent-strong: #1ba99a; --overlay-danger: #ff6b6b; --overlay-border: rgba(255,255,255,.18); --overlay-shadow: rgba(0,0,0,.34); }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; cursor: none; user-select: none; font-family: system-ui,-apple-system,Segoe UI,sans-serif; }
#frozenFrame { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
#dim { position: fixed; inset: 0; background: rgba(0,0,0,.48); pointer-events: none; }
body.has-selection #dim { background: transparent; }
#guideX, #guideY { position: fixed; display: none; z-index: 2147483640; pointer-events: none; background: rgba(255,255,255,.58); mix-blend-mode: difference; }
#guideX { left: 0; top: 0; bottom: 0; width: 1px; transform: translateX(-9999px); }
#guideY { left: 0; top: 0; right: 0; height: 1px; transform: translateY(-9999px); }
#guideX.visible, #guideY.visible { display: block; }
#cursorReticle { position: fixed; left: 0; top: 0; width: 16px; height: 16px; margin: -8px 0 0 -8px; pointer-events: none; z-index: 2147483647; transform: translate3d(-9999px,-9999px,0); opacity: .94; transition: opacity 70ms ease; }
#cursorReticle::before, #cursorReticle::after { content: ""; position: absolute; left: 50%; top: 50%; background: #f5ffff; box-shadow: 0 0 0 1px rgba(0,0,0,.82), 0 0 4px rgba(53,213,199,.48); transform: translate(-50%, -50%); }
#cursorReticle::before { width: 1px; height: 16px; }
#cursorReticle::after { width: 16px; height: 1px; }
#cursorReticle.hidden, #cursorReticle:not([data-cursor="crosshair"]) { opacity: 0; }
#sel { position: absolute; display: none; border: 2px solid var(--overlay-accent); background: rgba(53,213,199,.04); box-shadow: 0 0 0 9999px rgba(0,0,0,.46), 0 0 0 1px rgba(255,255,255,.78) inset, 0 0 0 1px rgba(53,213,199,.25); box-sizing: border-box; cursor: default; touch-action: none; }
#anno { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
#textInput { position: absolute; display: none; min-width: 120px; max-width: calc(100% - 10px); height: 34px; z-index: 2; box-sizing: border-box; border: 1px solid var(--overlay-accent); border-radius: 8px; padding: 0 8px; color: #ff4d4f; background: rgba(15,18,24,.96); outline: none; box-shadow: 0 8px 22px rgba(0,0,0,.28); }
#sel.invalid { border-color: var(--overlay-danger); background: rgba(255,107,107,.06); box-shadow: 0 0 0 9999px rgba(0,0,0,.48), 0 0 0 1px rgba(255,255,255,.72) inset, 0 0 0 1px rgba(255,107,107,.35); }
#chip { position: absolute; transform: translateY(calc(-100% - 7px)); padding: 4px 8px; border-radius: 8px; background: rgba(15,18,24,.92); color: var(--overlay-text); font-size: 12px; line-height: 1.2; white-space: nowrap; box-shadow: 0 5px 16px rgba(0,0,0,.24); pointer-events: none; }
#sel.invalid #chip { background: rgba(92,20,25,.95); }
.handle { position: absolute; width: 9px; height: 9px; border-radius: 3px; background: var(--overlay-accent); border: 1px solid rgba(255,255,255,.95); box-shadow: 0 2px 6px rgba(0,0,0,.28); box-sizing: border-box; }
#sel.invalid .handle { background: var(--overlay-danger); }
#bar { position: absolute; display: none; align-items: center; flex-wrap: wrap; gap: 6px; max-width: calc(100vw - 16px); max-height: min(220px, calc(100vh - 16px)); overflow: auto; padding: 7px; border-radius: 11px; background: rgba(15,18,24,.94); box-shadow: 0 10px 30px var(--overlay-shadow); cursor: default; z-index: 10; }
.sep { width: 1px; height: 20px; background: var(--overlay-border); margin: 0 2px; }
button { height: 32px; min-width: 42px; border: 0; border-radius: 8px; padding: 0 11px; color: var(--overlay-text); background: rgba(255,255,255,.15); font-size: 12px; font-weight: 650; cursor: pointer; }
button:hover:not(:disabled) { background: rgba(255,255,255,.22); }
button.primary { background: var(--overlay-accent-strong); }
button.primary:hover:not(:disabled) { background: #22bfae; }
button.active { color: #071416; background: var(--overlay-accent); }
button.danger { color: #ffb1b1; }
button:disabled { opacity: .42; cursor: not-allowed; }
.anno-control { height: 32px; display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; border-radius: 8px; color: rgba(255,255,255,.9); background: rgba(255,255,255,.12); font-size: 11.5px; font-weight: 650; white-space: nowrap; box-sizing: border-box; }
.anno-control input[type="color"] { width: 26px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; }
.anno-control input[type="range"] { width: 76px; }
#sizeValue { min-width: 28px; text-align: right; color: var(--overlay-text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
#hint { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); padding: 8px 12px; border-radius: 10px; color: var(--overlay-text); background: rgba(15,18,24,.76); font-size: 12px; pointer-events: none; z-index: 20; }
#screenSelect { position: fixed; left: 16px; top: 16px; z-index: 21; }
#magnifier { position: fixed; display: none; z-index: 2147483646; width: 148px; padding: 7px; border: 1px solid rgba(255,255,255,.42); border-radius: 10px; background: rgba(15,18,24,.94); box-shadow: 0 9px 24px rgba(0,0,0,.38); color: var(--overlay-text); pointer-events: none; }
#magnifier.visible { display: block; }
#magnifierCanvas { display: block; width: 148px; height: 100px; border-radius: 5px; image-rendering: pixelated; background: #000; }
#sampleSwatch { display: inline-block; width: 11px; height: 11px; margin-right: 5px; border: 1px solid rgba(255,255,255,.58); border-radius: 3px; vertical-align: -1px; }
.sample-line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
#metricStatus { color: var(--overlay-muted); }
</style>
</head>
<body>
<img id="frozenFrame" alt="" draggable="false" />
<div id="dim"></div>
<div id="guideX" aria-hidden="true"></div><div id="guideY" aria-hidden="true"></div>
<div id="cursorReticle" class="hidden" aria-hidden="true"></div>
<button id="screenSelect" type="button" title="选择当前屏幕（Ctrl+A）">当前屏</button>
<div id="hint">拖拽选择区域；Shift 锁定比例；方向键微调；Esc 取消</div>
<div id="magnifier" aria-hidden="true"><canvas id="magnifierCanvas" width="296" height="200"></canvas><div class="sample-line" id="sampleCoords">PX —</div><div class="sample-line"><i id="sampleSwatch"></i><span id="sampleHex">#------</span></div><div class="sample-line" id="sampleRgb">RGB —</div><div class="sample-line" id="sampleHsv">HSV —</div><div class="sample-line" id="metricStatus">视口 —</div></div>
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
  <label class="anno-control">颜色<input id="annoColor" type="color" value="#ff4d4f" /></label>
  <label class="anno-control"><span id="sizeLabel">线宽</span><input id="sizeRange" type="range" min="2" max="16" value="4" /><span id="sizeValue">4px</span></label>
  <button id="undoAnno">撤销</button>
  <button id="redoAnno">重做</button>
  <button id="clearAnno">清除</button>
  <span class="sep"></span>
  <button class="danger" id="cancel">取消</button>
  <button class="primary" data-action="default">✓</button>
</div>
<script>
const META = ${serializeForInlineScript(meta)};
${frameReceiver}
const OVERLAY_SELECTION_CONTRACT = Object.freeze({ version: ${serializeForInlineScript(OVERLAY_SELECTION_CONTRACT.version)} });
${helpers}
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
let lastPointer = { x: 0, y: 0 };
let shiftHeld = false;
let sending = false;
const frameImage = document.getElementById('frozenFrame');
const sel = document.getElementById('sel');
const anno = document.getElementById('anno');
const annoCtx = anno.getContext('2d');
const textInput = document.getElementById('textInput');
const cursorReticle = document.getElementById('cursorReticle');
const guideX = document.getElementById('guideX');
const guideY = document.getElementById('guideY');
const chip = document.getElementById('chip');
const bar = document.getElementById('bar');
const hint = document.getElementById('hint');
const colorInput = document.getElementById('annoColor');
const sizeRange = document.getElementById('sizeRange');
const sizeLabel = document.getElementById('sizeLabel');
const sizeValue = document.getElementById('sizeValue');
const screenSelect = document.getElementById('screenSelect');
const magnifier = document.getElementById('magnifier');
const magnifierCanvas = document.getElementById('magnifierCanvas');
const magnifierCtx = magnifierCanvas.getContext('2d');
const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = 1;
sampleCanvas.height = 1;
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
const sampleCoords = document.getElementById('sampleCoords');
const sampleSwatch = document.getElementById('sampleSwatch');
const sampleHex = document.getElementById('sampleHex');
const sampleRgb = document.getElementById('sampleRgb');
const sampleHsv = document.getElementById('sampleHsv');
const metricStatus = document.getElementById('metricStatus');
function pageViewport() {
  return { width: innerWidth, height: innerHeight, devicePixelRatio: window.devicePixelRatio || 1 };
}
function renderedMetrics() {
  const viewport = pageViewport();
  const bounds = frameImage.getBoundingClientRect();
  return createOverlayMetrics(viewport, {
    x: bounds.width > 0 ? bounds.left : 0,
    y: bounds.height > 0 ? bounds.top : 0,
    width: bounds.width > 0 ? bounds.width : viewport.width,
    height: bounds.height > 0 ? bounds.height : viewport.height,
  }, { width: frameImage.naturalWidth, height: frameImage.naturalHeight });
}
function updateMetricStatus(metrics) {
  metricStatus.textContent = '视口 ' + metrics.viewport.width + '×' + metrics.viewport.height + ' · 图像 ' + Math.round(metrics.renderedImageRect.width) + '×' + Math.round(metrics.renderedImageRect.height) + ' · DPR ' + metrics.viewport.devicePixelRatio;
}
function pointInRect(point, currentRect) {
  return Boolean(currentRect && point.x >= currentRect.x && point.x <= currentRect.x + currentRect.width && point.y >= currentRect.y && point.y <= currentRect.y + currentRect.height);
}
function isInteractive(target) {
  return Boolean(target && target.closest && target.closest('button, #bar, #chip, #textInput'));
}
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
function resizeEdgeFromPoint(point, currentRect) {
  if (!currentRect) return '';
  const inX = point.x >= currentRect.x - EDGE_HIT && point.x <= currentRect.x + currentRect.width + EDGE_HIT;
  const inY = point.y >= currentRect.y - EDGE_HIT && point.y <= currentRect.y + currentRect.height + EDGE_HIT;
  const nearTop = inX && Math.abs(point.y - currentRect.y) <= EDGE_HIT;
  const nearBottom = inX && Math.abs(point.y - (currentRect.y + currentRect.height)) <= EDGE_HIT;
  const nearLeft = inY && Math.abs(point.x - currentRect.x) <= EDGE_HIT;
  const nearRight = inY && Math.abs(point.x - (currentRect.x + currentRect.width)) <= EDGE_HIT;
  return (nearTop ? 'n' : nearBottom ? 's' : '') + (nearLeft ? 'w' : nearRight ? 'e' : '');
}
function resizeEdgeForEvent(target, point) {
  return edgeFromTarget(target) || resizeEdgeFromPoint(point, rect);
}
function updateHoverCursor(point) {
  if (!completed || selecting || resizing || !rect) {
    setOverlayCursor('crosshair');
    return;
  }
  const edge = resizeEdgeFromPoint(point, rect);
  setOverlayCursor(edge ? cursorForEdge(edge) : (pointInRect(point, rect) && !activeTool ? 'default' : 'crosshair'));
}
function cursorReticleShouldHide(target, point) {
  const interactive = target && target.closest && target.closest('#bar, button, input, .handle');
  return Boolean(interactive || (completed && !resizing && rect && resizeEdgeFromPoint(point, rect)));
}
function updateGuides(point, target) {
  const hidden = cursorReticleShouldHide(target, point);
  guideX.style.transform = 'translateX(' + Math.round(point.x) + 'px)';
  guideY.style.transform = 'translateY(' + Math.round(point.y) + 'px)';
  guideX.classList.toggle('visible', !hidden);
  guideY.classList.toggle('visible', !hidden);
}
function updateCursorReticle(point, target) {
  lastPointer = { x: point.x, y: point.y };
  cursorReticle.style.transform = 'translate3d(' + point.x + 'px,' + point.y + 'px,0)';
  cursorReticle.classList.toggle('hidden', cursorReticleShouldHide(target, point));
  updateGuides(point, target);
  updateSampler(point);
}
function targetAtPoint(point) { return document.elementFromPoint(point.x, point.y); }
function updateButtons() {
  const valid = isValid();
  sel.classList.toggle('invalid', Boolean(rect) && !valid);
  chip.textContent = valid || !rect ? (rect ? rect.width + ' × ' + rect.height : '') : '选区过小';
  bar.querySelectorAll('button[data-action]').forEach((button) => { button.disabled = !valid || sending; });
  bar.querySelectorAll('button[data-tool]').forEach((button) => {
    const tool = button.getAttribute('data-tool');
    button.disabled = !valid || sending;
    button.classList.toggle('active', tool === activeTool);
  });
  document.getElementById('undoAnno').disabled = sending || undoStack.length === 0;
  document.getElementById('redoAnno').disabled = sending || redoStack.length === 0;
  document.getElementById('clearAnno').disabled = sending || annotations.length === 0;
  document.getElementById('cancel').disabled = sending;
  screenSelect.disabled = sending;
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
  if (!activeTool) return '选择模式：双击选区确认，方向键微调，Ctrl+A 当前屏';
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
  updateHoverCursor(lastPointer);
  updateButtons();
}
function updateSizeControl() {
  if (activeTool === 'text') {
    sizeLabel.textContent = '字号'; sizeRange.min = '14'; sizeRange.max = '64'; sizeRange.value = String(fontSize); sizeValue.textContent = fontSize + 'px';
  } else if (activeTool === 'mosaic') {
    sizeLabel.textContent = '马赛克'; sizeRange.min = '12'; sizeRange.max = '72'; sizeRange.value = String(mosaicSize); sizeValue.textContent = mosaicSize + 'px';
  } else {
    sizeLabel.textContent = '线宽'; sizeRange.min = '2'; sizeRange.max = '16'; sizeRange.value = String(lineWidth); sizeValue.textContent = lineWidth + 'px';
  }
}
function localPoint(point) {
  return { x: clamp(point.x - rect.x, 0, rect.width), y: clamp(point.y - rect.y, 0, rect.height) };
}
function clonePoint(point) { return { x: point.x, y: point.y }; }
function cloneAnnotationShape(shape) {
  return shape.kind === 'brush' || shape.kind === 'mosaic' ? { ...shape, points: shape.points.map(clonePoint) } : { ...shape };
}
function snapshotAnnotations() { return annotations.map(cloneAnnotationShape); }
function applyAnnotationChange(next) {
  undoStack.unshift(snapshotAnnotations());
  undoStack = undoStack.slice(0, 40);
  redoStack = [];
  annotations = next.map(cloneAnnotationShape);
  redrawAnnotations();
  updateButtons();
}
function commitAnnotation(shape) { if (isValidAnnotationShape(shape)) applyAnnotationChange([...annotations, shape]); }
function undoAnnotation() {
  if (!undoStack.length) return;
  redoStack.unshift(snapshotAnnotations()); annotations = undoStack.shift(); redrawAnnotations(); updateButtons();
}
function redoAnnotation() {
  if (!redoStack.length) return;
  undoStack.unshift(snapshotAnnotations()); annotations = redoStack.shift(); redrawAnnotations(); updateButtons();
}
function syncAnnotationCanvas() {
  const width = Math.max(1, rect ? rect.width : 1); const height = Math.max(1, rect ? rect.height : 1);
  if (anno.width !== width) anno.width = width;
  if (anno.height !== height) anno.height = height;
}
function drawArrow(context, shape) {
  const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1); const width = Math.max(1, shape.width || lineWidth); const head = Math.max(12, width * 5);
  context.strokeStyle = shape.color || annoColor; context.fillStyle = shape.color || annoColor; context.lineWidth = width; context.lineJoin = 'round'; context.lineCap = 'round';
  context.beginPath(); context.moveTo(shape.x1, shape.y1); context.lineTo(shape.x2, shape.y2); context.stroke();
  context.beginPath(); context.moveTo(shape.x2, shape.y2); context.lineTo(shape.x2 - head * Math.cos(angle - Math.PI / 6), shape.y2 - head * Math.sin(angle - Math.PI / 6)); context.lineTo(shape.x2 - head * Math.cos(angle + Math.PI / 6), shape.y2 - head * Math.sin(angle + Math.PI / 6)); context.closePath(); context.fill();
}
function drawPolyline(context, shape) {
  if (!shape.points || shape.points.length < 2) return;
  context.strokeStyle = shape.color || annoColor; context.lineWidth = Math.max(1, shape.width || lineWidth); context.lineJoin = 'round'; context.lineCap = 'round'; context.beginPath(); context.moveTo(shape.points[0].x, shape.points[0].y); shape.points.slice(1).forEach((point) => context.lineTo(point.x, point.y)); context.stroke();
}
function drawMosaicPreview(context, shape) {
  if (!shape.points || shape.points.length < 1) return;
  const radius = Math.max(6, (shape.size || mosaicSize) / 2); context.save(); context.fillStyle = 'rgba(255,255,255,.26)'; context.strokeStyle = 'rgba(53,213,199,.82)'; context.lineWidth = 1;
  for (const point of shape.points) { context.beginPath(); context.rect(point.x - radius, point.y - radius, radius * 2, radius * 2); context.fill(); context.stroke(); }
  context.restore();
}
function drawAnnotationShape(context, shape) {
  context.save(); context.strokeStyle = shape.color || annoColor; context.fillStyle = shape.color || annoColor; context.lineWidth = Math.max(1, shape.lineWidth || lineWidth); context.lineJoin = 'round'; context.lineCap = 'round';
  if (shape.kind === 'arrow') drawArrow(context, shape);
  else if (shape.kind === 'rect') context.strokeRect(shape.x, shape.y, shape.width, shape.height);
  else if (shape.kind === 'circle') { context.beginPath(); context.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, Math.max(.5, shape.width / 2), Math.max(.5, shape.height / 2), 0, 0, Math.PI * 2); context.stroke(); }
  else if (shape.kind === 'brush') drawPolyline(context, shape);
  else if (shape.kind === 'text') { context.font = Math.max(12, shape.fontSize || fontSize) + 'px system-ui,-apple-system,Segoe UI,sans-serif'; context.textBaseline = 'top'; context.fillText(shape.text, shape.x, shape.y); }
  else if (shape.kind === 'mosaic') drawMosaicPreview(context, shape);
  context.restore();
}
function draftAnnotationShape() { return drawingAnnotation ? drawingAnnotation.shape : null; }
function redrawAnnotations() {
  syncAnnotationCanvas(); annoCtx.clearRect(0, 0, anno.width, anno.height); annotations.forEach((shape) => drawAnnotationShape(annoCtx, shape)); const draft = draftAnnotationShape(); if (draft) drawAnnotationShape(annoCtx, draft);
}
function cancelPendingText() { if (textClickTimer) window.clearTimeout(textClickTimer); textClickTimer = 0; }
function hideTextInput() { textInput.style.display = 'none'; textInput.value = ''; textDraft = null; }
function discardAnnotations() { annotations = []; undoStack = []; redoStack = []; drawingAnnotation = null; cancelPendingText(); hideTextInput(); }
function showTextInput(local) {
  textDraft = { x: clamp(local.x, 0, Math.max(0, rect.width - 24)), y: clamp(local.y, 0, Math.max(0, rect.height - fontSize - 10)) };
  textInput.value = ''; textInput.style.left = textDraft.x + 'px'; textInput.style.top = textDraft.y + 'px'; textInput.style.height = Math.max(32, fontSize + 10) + 'px'; textInput.style.fontSize = Math.max(12, fontSize) + 'px'; textInput.style.color = annoColor; textInput.style.display = 'block'; textInput.focus({ preventScroll: true });
}
function scheduleTextInput(local) { cancelPendingText(); textClickTimer = window.setTimeout(() => { textClickTimer = 0; showTextInput(local); }, TEXT_CLICK_DELAY); }
function commitTextInput() {
  cancelPendingText(); if (!textDraft) return;
  const text = textInput.value.trim(); const shape = { kind: 'text', x: textDraft.x, y: textDraft.y, text, color: annoColor, fontSize }; hideTextInput(); if (text) commitAnnotation(shape);
}
function isValidAnnotationShape(shape) {
  if (!shape) return false;
  if (shape.kind === 'arrow') return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) >= ANNO_MIN;
  if (shape.kind === 'rect' || shape.kind === 'circle') return shape.width >= ANNO_MIN && shape.height >= ANNO_MIN;
  if (shape.kind === 'brush' || shape.kind === 'mosaic') return shape.points && shape.points.length >= 2;
  return shape.kind === 'text' && String(shape.text || '').trim().length > 0;
}
function beginAnnotation(point) {
  if (!rect || !isAnnotationTool(activeTool) || !pointInRect(point, rect)) return false;
  const local = localPoint(point); if (activeTool === 'text') { scheduleTextInput(local); return true; }
  const color = annoColor;
  if (activeTool === 'arrow') drawingAnnotation = { start: local, shape: { kind: 'arrow', x1: local.x, y1: local.y, x2: local.x, y2: local.y, color, width: lineWidth } };
  else if (activeTool === 'rect') drawingAnnotation = { start: local, shape: { kind: 'rect', x: local.x, y: local.y, width: 0, height: 0, color, lineWidth } };
  else if (activeTool === 'circle') drawingAnnotation = { start: local, shape: { kind: 'circle', x: local.x, y: local.y, width: 0, height: 0, color, lineWidth } };
  else if (activeTool === 'brush') drawingAnnotation = { start: local, shape: { kind: 'brush', points: [local], color, width: lineWidth } };
  else drawingAnnotation = { start: local, shape: { kind: 'mosaic', points: [local], size: mosaicSize, block: Math.max(6, Math.round(mosaicSize / 3)) } };
  hint.textContent = annotationHint(); setOverlayCursor('crosshair'); redrawAnnotations(); return true;
}
function updateAnnotation(point) {
  if (!drawingAnnotation) return;
  const local = localPoint(point); const shape = drawingAnnotation.shape;
  if (shape.kind === 'arrow') { shape.x2 = local.x; shape.y2 = local.y; }
  else if (shape.kind === 'rect' || shape.kind === 'circle') { const next = rectFromPoints(drawingAnnotation.start, local); shape.x = next.x; shape.y = next.y; shape.width = next.width; shape.height = next.height; }
  else if (shape.kind === 'brush' || shape.kind === 'mosaic') { const last = shape.points[shape.points.length - 1]; if (!last || Math.hypot(local.x - last.x, local.y - last.y) >= 1) shape.points.push(local); }
  redrawAnnotations();
}
function finishAnnotation(point) { if (!drawingAnnotation) return; updateAnnotation(point); const shape = draftAnnotationShape(); drawingAnnotation = null; if (shape) commitAnnotation(shape); hint.textContent = annotationHint(); redrawAnnotations(); updateButtons(); }
function annotationPayload() {
  commitTextInput();
  return annotations.map((shape) => {
    if (shape.kind === 'arrow') return { kind: 'arrow', x1: Math.round(shape.x1), y1: Math.round(shape.y1), x2: Math.round(shape.x2), y2: Math.round(shape.y2), color: shape.color, width: shape.width };
    if (shape.kind === 'brush') return { kind: 'brush', points: shape.points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })), color: shape.color, width: shape.width };
    if (shape.kind === 'text') return { kind: 'text', x: Math.round(shape.x), y: Math.round(shape.y), text: shape.text, color: shape.color, fontSize: shape.fontSize };
    if (shape.kind === 'mosaic') return { kind: 'mosaic', points: shape.points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })), size: shape.size, block: shape.block };
    return { kind: shape.kind, x: Math.round(shape.x), y: Math.round(shape.y), width: Math.round(shape.width), height: Math.round(shape.height), color: shape.color, lineWidth: shape.lineWidth };
  });
}
function overlayUrl(kind, payload) { return 'ttool-overlay://' + kind + '?payload=' + encodeURIComponent(JSON.stringify(payload)); }
function fallbackOverlay(kind, payload) {
  try { window.location.href = overlayUrl(kind, payload); } catch (error) { showBridgeError('截图桥接不可用，请重试'); }
}
function sendOverlay(kind, payload) {
  if (sending) return;
  sending = true; updateButtons();
  const api = window.ttool && window.ttool.screenshot; const method = api && (kind === 'cancel' ? api.overlayCancel : api.overlaySelect);
  if (typeof method === 'function') { Promise.resolve(method(payload)).then((result) => { if (result && result.ok === false) showBridgeError(result.error); }).catch(() => fallbackOverlay(kind, payload)); return; }
  fallbackOverlay(kind, payload);
}
function positionChip() {
  if (!rect) return;
  const chipWidth = chip.offsetWidth || 72; const maxLeft = Math.max(0, rect.width - chipWidth); const leftLimit = Math.max(0, innerWidth - rect.x - chipWidth - 8);
  chip.style.left = Math.min(maxLeft, leftLimit) + 'px';
  if (rect.y > chip.offsetHeight + 12) { chip.style.top = '0'; chip.style.transform = 'translateY(calc(-100% - 7px))'; }
  else { chip.style.top = '6px'; chip.style.transform = 'none'; }
}
function renderHandles() {
  sel.querySelectorAll('.handle').forEach((node) => node.remove());
  for (const position of [['nw',0,0],['n',50,0],['ne',100,0],['w',0,50],['e',100,50],['sw',0,100],['s',50,100],['se',100,100]]) {
    const handle = document.createElement('i'); handle.className = 'handle'; handle.setAttribute('data-edge', position[0]); handle.style.left = 'calc(' + position[1] + '% - 4.5px)'; handle.style.top = 'calc(' + position[2] + '% - 4.5px)'; handle.style.cursor = cursorForEdge(position[0]); sel.appendChild(handle);
  }
}
function setRect(nextRect) {
  const viewport = pageViewport(); const normalized = normalizeOverlayRect(nextRect, viewport); const x = Math.round(normalized.x); const y = Math.round(normalized.y);
  rect = { x, y, width: Math.round(clamp(normalized.width, 0, viewport.width - x)), height: Math.round(clamp(normalized.height, 0, viewport.height - y)) };
  document.body.classList.add('has-selection'); sel.style.display = 'block'; sel.style.left = rect.x + 'px'; sel.style.top = rect.y + 'px'; sel.style.width = rect.width + 'px'; sel.style.height = rect.height + 'px'; redrawAnnotations(); updateButtons(); positionChip(); renderHandles();
}
function updateBar() {
  if (!rect) return;
  bar.style.display = 'flex'; updateButtons();
  const width = bar.offsetWidth || 360; const height = bar.offsetHeight || 46; const below = rect.y + rect.height + 10; const above = rect.y - height - 10;
  bar.style.left = clamp(rect.x + rect.width / 2 - width / 2, 8, Math.max(8, innerWidth - width - 8)) + 'px';
  bar.style.top = (below + height + 8 <= innerHeight ? below : clamp(above, 8, Math.max(8, innerHeight - height - 8))) + 'px';
}
function beginSelection(point) {
  selecting = true; resizing = null; discardAnnotations(); completed = false; pendingInsideClick = false; bar.style.display = 'none'; hint.textContent = '拖拽选择区域，Shift 锁定为正方形，Esc 取消'; setOverlayCursor('crosshair'); start = point; setRect({ x: start.x, y: start.y, width: 0, height: 0 });
}
function updateSelection(point, constrainAspect) { if (start) setRect(constrainSelectionDrag(start, point, pageViewport(), constrainAspect)); }
function beginResize(edge) {
  if (!rect || !edge) return;
  discardAnnotations(); redrawAnnotations(); resizing = { edge, origin: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }; selecting = false; completed = false; pendingInsideClick = false; bar.style.display = 'none'; hint.textContent = '拖动边框调整区域，按 Shift 保持比例'; setOverlayCursor(cursorForEdge(edge));
}
function updateResize(point, constrainAspect) { if (resizing) setRect(resizeSelectionRect(resizing.origin, resizing.edge, point, pageViewport(), constrainAspect)); }
function finishResize(point) { if (!resizing) return; resizing = null; completed = true; hint.textContent = annotationHint(); updateBar(); updateHoverCursor(point); updateCursorReticle(point, targetAtPoint(point)); }
function selectCurrentScreen() {
  discardAnnotations(); selecting = false; resizing = null; completed = true; pendingInsideClick = false; const viewport = pageViewport(); setRect({ x: 0, y: 0, width: viewport.width, height: viewport.height }); hint.textContent = '已选择当前屏幕；方向键可微调位置'; updateBar(); updateCursorReticle(lastPointer, targetAtPoint(lastPointer));
}
function sourcePointForClient(point, metrics) {
  const imageRect = metrics.renderedImageRect; const size = metrics.frameSize;
  if (size.width < 1 || size.height < 1 || point.x < imageRect.x || point.y < imageRect.y || point.x > imageRect.x + imageRect.width || point.y > imageRect.y + imageRect.height) return null;
  return { x: clamp(Math.floor((point.x - imageRect.x) * size.width / imageRect.width), 0, size.width - 1), y: clamp(Math.floor((point.y - imageRect.y) * size.height / imageRect.height), 0, size.height - 1) };
}
function positionMagnifier(point) {
  const left = clamp(Math.round(point.x + 18), 6, Math.max(6, innerWidth - 160)); const top = clamp(Math.round(point.y + 18), 6, Math.max(6, innerHeight - 190)); magnifier.style.left = left + 'px'; magnifier.style.top = top + 'px';
}
function updateSampler(point) {
  const metrics = renderedMetrics(); updateMetricStatus(metrics); positionMagnifier(point);
  const source = sourcePointForClient(point, metrics);
  if (!source) { magnifier.classList.remove('visible'); return; }
  magnifier.classList.add('visible');
  try {
    const span = Math.max(1, Math.min(30, Math.floor(Math.min(metrics.frameSize.width, metrics.frameSize.height) / 8) || 1));
    const sx = clamp(source.x - Math.floor(span / 2), 0, Math.max(0, metrics.frameSize.width - span)); const sy = clamp(source.y - Math.floor(span / 2), 0, Math.max(0, metrics.frameSize.height - span));
    magnifierCtx.imageSmoothingEnabled = false; magnifierCtx.clearRect(0, 0, magnifierCanvas.width, magnifierCanvas.height); magnifierCtx.drawImage(frameImage, sx, sy, span, span, 0, 0, magnifierCanvas.width, magnifierCanvas.height); magnifierCtx.strokeStyle = 'rgba(255,255,255,.94)'; magnifierCtx.lineWidth = 2; magnifierCtx.strokeRect(magnifierCanvas.width / 2 - 5, magnifierCanvas.height / 2 - 5, 10, 10);
    sampleCtx.clearRect(0, 0, 1, 1); sampleCtx.drawImage(frameImage, source.x, source.y, 1, 1, 0, 0, 1, 1); const data = sampleCtx.getImageData(0, 0, 1, 1).data; const sample = formatPixelSample({ r: data[0], g: data[1], b: data[2], a: data[3] });
    sampleCoords.textContent = 'PX ' + source.x + ', ' + source.y; sampleSwatch.style.background = sample.hex; sampleHex.textContent = sample.hex.toUpperCase(); sampleRgb.textContent = sample.rgb; sampleHsv.textContent = sample.hsv;
  } catch (error) {
    sampleCoords.textContent = 'PX ' + source.x + ', ' + source.y; sampleHex.textContent = '取色不可用'; sampleRgb.textContent = 'RGB —'; sampleHsv.textContent = 'HSV —';
  }
}
function submit(action) {
  if (!isValid()) { updateButtons(); return; }
  const resolved = action === 'default' ? META.defaultAction : action;
  const payload = buildOverlaySelectionPayload(META, rect, renderedMetrics(), resolved, annotationPayload());
  sendOverlay('select', payload);
}
window.addEventListener('mousedown', (event) => {
  const point = { x: event.clientX, y: event.clientY }; updateCursorReticle(point, event.target); if (isInteractive(event.target)) return;
  downPoint = point; movedSinceDown = false;
  if (completed && isValid() && pointInRect(point, rect) && event.detail >= 2) { event.preventDefault(); cancelPendingText(); return; }
  const edge = completed ? resizeEdgeForEvent(event.target, point) : '';
  if (edge) { event.preventDefault(); beginResize(edge); return; }
  if (completed && isValid() && pointInRect(point, rect) && activeTool) { event.preventDefault(); beginAnnotation(point); return; }
  if (completed && isValid() && pointInRect(point, rect)) { pendingInsideClick = true; return; }
  beginSelection(point);
});
window.addEventListener('mousemove', (event) => {
  const point = { x: event.clientX, y: event.clientY }; updateCursorReticle(point, event.target);
  if (resizing) { updateResize(point, event.shiftKey || shiftHeld); return; }
  if (drawingAnnotation) { updateAnnotation(point); return; }
  if (downPoint && Math.hypot(point.x - downPoint.x, point.y - downPoint.y) > 4) movedSinceDown = true;
  if (pendingInsideClick && movedSinceDown && downPoint) beginSelection(downPoint);
  if (!selecting || !start) { updateHoverCursor(point); return; }
  updateSelection(point, event.shiftKey || shiftHeld);
});
window.addEventListener('mouseup', (event) => {
  const point = { x: event.clientX, y: event.clientY }; updateCursorReticle(point, event.target);
  if (resizing) { finishResize(point); return; }
  if (drawingAnnotation) { finishAnnotation(point); return; }
  if (pendingInsideClick) { pendingInsideClick = false; return; }
  if (!selecting) return;
  selecting = false; completed = true; hint.textContent = annotationHint(); updateBar(); updateCursorReticle(point, targetAtPoint(point));
});
window.addEventListener('dblclick', (event) => {
  const point = { x: event.clientX, y: event.clientY }; updateCursorReticle(point, event.target); cancelPendingText();
  if (isInteractive(event.target) || movedSinceDown || selecting || resizing || drawingAnnotation || !completed || !isValid() || !pointInRect(point, rect)) return;
  submit('default');
});
window.addEventListener('mouseenter', (event) => updateCursorReticle({ x: event.clientX, y: event.clientY }, event.target));
window.addEventListener('mouseleave', () => { cursorReticle.classList.add('hidden'); guideX.classList.remove('visible'); guideY.classList.remove('visible'); magnifier.classList.remove('visible'); });
window.addEventListener('keydown', (event) => {
  if (event.key === 'Shift') { shiftHeld = true; if (selecting) updateSelection(lastPointer, true); else if (resizing) updateResize(lastPointer, true); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectCurrentScreen(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undoAnnotation(); return; }
  if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); redoAnnotation(); return; }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && completed && isValid() && !textDraft && !drawingAnnotation) { event.preventDefault(); setRect(nudgeSelectionRect(rect, event.key, pageViewport(), event.shiftKey ? 10 : 1)); hint.textContent = '已微调 ' + (event.shiftKey ? '10' : '1') + 'px；Shift+方向键快速移动'; updateBar(); updateCursorReticle(lastPointer, targetAtPoint(lastPointer)); return; }
  if (event.key === 'Escape' && drawingAnnotation) { event.preventDefault(); drawingAnnotation = null; redrawAnnotations(); hint.textContent = annotationHint(); return; }
  if (event.key === 'Escape' && (textDraft || textClickTimer)) { event.preventDefault(); cancelPendingText(); hideTextInput(); return; }
  if (event.key === 'Escape') sendOverlay('cancel', { captureId: META.captureId, reason: '截图已取消' });
});
window.addEventListener('keyup', (event) => {
  if (event.key !== 'Shift') return;
  shiftHeld = false; if (selecting) updateSelection(lastPointer, false); else if (resizing) updateResize(lastPointer, false);
});
textInput.addEventListener('keydown', (event) => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); commitTextInput(); } else if (event.key === 'Escape') { event.preventDefault(); hideTextInput(); } });
textInput.addEventListener('blur', () => window.setTimeout(commitTextInput, 0));
colorInput.addEventListener('input', () => { annoColor = colorInput.value || DEFAULT_ANNO_COLOR; textInput.style.color = annoColor; });
sizeRange.addEventListener('input', () => { const value = Number(sizeRange.value) || 0; if (activeTool === 'text') fontSize = clamp(Math.round(value), 14, 64); else if (activeTool === 'mosaic') mosaicSize = clamp(Math.round(value), 12, 72); else lineWidth = clamp(Math.round(value), 2, 16); updateSizeControl(); });
screenSelect.onclick = () => selectCurrentScreen();
document.getElementById('cancel').onclick = () => sendOverlay('cancel', { captureId: META.captureId, reason: '截图已取消' });
bar.querySelectorAll('button[data-tool]').forEach((button) => { button.onclick = () => setActiveTool(button.getAttribute('data-tool')); });
document.getElementById('undoAnno').onclick = () => undoAnnotation();
document.getElementById('redoAnno').onclick = () => redoAnnotation();
document.getElementById('clearAnno').onclick = () => { if (annotations.length) applyAnnotationChange([]); };
bar.querySelectorAll('button[data-action]').forEach((button) => { button.onclick = () => submit(button.getAttribute('data-action')); });
frameImage.addEventListener('load', () => { updateMetricStatus(renderedMetrics()); updateSampler(lastPointer); });
window.addEventListener('resize', () => { if (rect) setRect(rect); if (completed) updateBar(); updateMetricStatus(renderedMetrics()); updateSampler(lastPointer); });
if (window.__ttoolOverlayFrameReady && typeof window.__ttoolOverlayFrameReady.then === 'function') Promise.resolve(window.__ttoolOverlayFrameReady).then(() => { updateMetricStatus(renderedMetrics()); updateSampler(lastPointer); }).catch(() => {});
updateSizeControl(); updateMetricStatus(renderedMetrics()); window.focus();
</script>
</body>
</html>`
}

module.exports = {
  OVERLAY_SELECTION_CONTRACT,
  buildOverlaySelectionPayload,
  buildScreenshotOverlayPage,
  constrainSelectionDrag,
  createOverlayMetrics,
  formatPixelSample,
  normalizeOverlayRect,
  normalizeOverlayViewport,
  normalizeRenderedImageRect,
  nudgeSelectionRect,
  resizeSelectionRect,
  rgbToHex,
  rgbToHsv,
}
