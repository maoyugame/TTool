'use strict'

const assert = require('node:assert/strict')
const vm = require('node:vm')
const {
  OVERLAY_SELECTION_CONTRACT,
  buildOverlaySelectionPayload,
  buildScreenshotOverlayPage,
  constrainSelectionDrag,
  createOverlayMetrics,
  formatPixelSample,
  nudgeSelectionRect,
  resizeSelectionRect,
} = require('../electron/screenshot-overlay-page.cjs')

function pageScript(html) {
  const start = html.lastIndexOf('<script>')
  const end = html.lastIndexOf('</script>')
  assert.ok(start >= 0 && end > start, 'overlay page must contain one executable page script')
  return html.slice(start + '<script>'.length, end)
}

function makeClassList() {
  const values = new Set()
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle: (name, force) => {
      const next = force === undefined ? !values.has(name) : Boolean(force)
      if (next) values.add(name)
      else values.delete(name)
      return next
    },
    has: (name) => values.has(name),
  }
}

function makeCanvasContext() {
  return {
    clearRect() {},
    drawImage() {},
    strokeRect() {},
    stroke() {},
    fill() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    rect() {},
    ellipse() {},
    save() {},
    restore() {},
    fillText() {},
    getImageData: () => ({ data: new Uint8ClampedArray([12, 34, 56, 255]) }),
  }
}

function makeElement(id = '') {
  const attributes = new Map()
  const listeners = new Map()
  const element = {
    id,
    style: {},
    classList: makeClassList(),
    children: [],
    value: '',
    disabled: false,
    offsetWidth: id === 'bar' ? 360 : id === 'chip' ? 72 : 0,
    offsetHeight: id === 'bar' ? 46 : id === 'chip' ? 20 : 0,
    addEventListener: (type, handler) => listeners.set(type, handler),
    appendChild: (child) => {
      element.children.push(child)
      return child
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) || '',
    closest: () => null,
    focus() {},
    remove() {},
    querySelectorAll: () => [],
    getContext: () => makeCanvasContext(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    _listeners: listeners,
  }
  return element
}

function bootPage(html) {
  const listeners = new Map()
  const submissions = []
  const elements = {}
  const ids = [
    'frozenFrame', 'sel', 'anno', 'textInput', 'cursorReticle', 'guideX', 'guideY', 'chip', 'bar', 'hint',
    'annoColor', 'sizeRange', 'sizeLabel', 'sizeValue', 'screenSelect', 'magnifier', 'magnifierCanvas',
    'sampleCoords', 'sampleSwatch', 'sampleHex', 'sampleRgb', 'sampleHsv', 'metricStatus', 'undoAnno',
    'redoAnno', 'clearAnno', 'cancel',
  ]
  ids.forEach((id) => { elements[id] = makeElement(id) })
  elements.frozenFrame.naturalWidth = 2000
  elements.frozenFrame.naturalHeight = 1200
  elements.frozenFrame.getBoundingClientRect = () => ({ left: 10, top: 20, width: 1000, height: 600 })
  elements.anno.getContext = () => makeCanvasContext()
  elements.magnifierCanvas.getContext = () => makeCanvasContext()
  elements.annoColor.value = '#ff4d4f'
  elements.sizeRange.value = '4'

  const actionButtons = ['copy', 'save', 'pin', 'default'].map((action) => {
    const button = makeElement('action-' + action)
    button.setAttribute('data-action', action)
    return button
  })
  const toolButtons = ['', 'arrow', 'rect', 'circle', 'brush', 'text', 'mosaic'].map((tool) => {
    const button = makeElement('tool-' + tool)
    button.setAttribute('data-tool', tool)
    return button
  })
  elements.defaultButton = actionButtons.find((button) => button.getAttribute('data-action') === 'default')
  elements.bar.querySelectorAll = (selector) => {
    if (selector === 'button[data-action]') return actionButtons
    if (selector === 'button[data-tool]') return toolButtons
    return []
  }
  elements.sel.querySelectorAll = (selector) => selector === '.handle' ? elements.sel.children : []

  const body = makeElement('body')
  const document = {
    body,
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => elements[id] || makeElement(id),
    elementFromPoint: () => body,
  }
  const window = {
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 1.5,
    document,
    location: { href: '' },
    setTimeout: () => 1,
    clearTimeout() {},
    focus() {},
    addEventListener: (type, handler) => listeners.set(type, handler),
    ttool: {
      screenshot: {
        onOverlayFrame: () => () => {},
        overlaySelect: (payload) => {
          submissions.push(payload)
          return { ok: true }
        },
        overlayCancel: () => ({ ok: true }),
      },
    },
  }
  const context = vm.createContext({
    window,
    document,
    innerWidth: 1200,
    innerHeight: 800,
    URL,
    Blob,
    Uint8Array,
    ArrayBuffer,
    Uint8ClampedArray,
  })
  new vm.Script(pageScript(html)).runInContext(context)
  return { elements, listeners, submissions, body }
}

function mouseEvent(x, y, target, extra = {}) {
  return { clientX: x, clientY: y, target, detail: 1, preventDefault() {}, ...extra }
}

function keyEvent(key, extra = {}) {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {}, ...extra }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function main() {
  assert.equal(OVERLAY_SELECTION_CONTRACT.version, 'overlay-css-px-v1')
  assert.deepEqual(OVERLAY_SELECTION_CONTRACT.selectFields, [
    'captureId',
    'displayId',
    'rect',
    'viewport',
    'renderedImageRect',
    'frameSize',
    'coordinateSpace',
    'action',
    'annotations',
  ])

  const metrics = createOverlayMetrics(
    { width: 1200, height: 800, devicePixelRatio: 1.5 },
    { x: 12.5, y: 8, width: 1175, height: 780 },
    { width: 2400, height: 1600 },
  )
  assert.deepEqual(metrics, {
    viewport: { width: 1200, height: 800, devicePixelRatio: 1.5 },
    renderedImageRect: { x: 12.5, y: 8, width: 1175, height: 780 },
    frameSize: { width: 2400, height: 1600 },
  })

  const annotation = { kind: 'arrow', x1: 3, y1: 4, x2: 40, y2: 50, color: '#ff0000', width: 4 }
  const payload = buildOverlaySelectionPayload(
    { captureId: 'capture-1', displayId: 7 },
    { x: 100, y: 120, width: 320, height: 180 },
    metrics,
    'pin',
    [annotation],
  )
  assert.deepEqual(payload, {
    captureId: 'capture-1',
    displayId: 7,
    rect: { x: 100, y: 120, width: 320, height: 180 },
    viewport: { width: 1200, height: 800, devicePixelRatio: 1.5 },
    renderedImageRect: { x: 12.5, y: 8, width: 1175, height: 780 },
    frameSize: { width: 2400, height: 1600 },
    coordinateSpace: 'overlay-css-px-v1',
    action: 'pin',
    annotations: [annotation],
  })

  assert.deepEqual(
    constrainSelectionDrag({ x: 100, y: 100 }, { x: 700, y: 200 }, { width: 800, height: 600 }, true),
    { x: 100, y: 100, width: 500, height: 500 },
    'Shift drag must keep a square inside the current overlay viewport',
  )
  assert.deepEqual(
    resizeSelectionRect({ x: 100, y: 100, width: 200, height: 100 }, 'se', { x: 500, y: 250 }, { width: 1000, height: 700 }, true),
    { x: 100, y: 100, width: 400, height: 200 },
    'Shift resize must retain the original selection aspect ratio',
  )
  assert.deepEqual(
    nudgeSelectionRect({ x: 10, y: 20, width: 100, height: 50 }, 'ArrowRight', { width: 400, height: 300 }),
    { x: 11, y: 20, width: 100, height: 50 },
    'an arrow key must nudge one CSS pixel by default',
  )
  assert.deepEqual(
    nudgeSelectionRect({ x: 290, y: 240, width: 100, height: 50 }, 'ArrowRight', { width: 400, height: 300 }, 10),
    { x: 300, y: 240, width: 100, height: 50 },
    'accelerated nudge must clamp to the current screen boundary',
  )
  assert.deepEqual(formatPixelSample({ r: 255, g: 128, b: 0, a: 64 }), {
    r: 255,
    g: 128,
    b: 0,
    a: 64,
    hex: '#ff8000',
    rgb: 'rgb(255, 128, 0)',
    hsv: 'hsv(30°, 100%, 100%)',
  })

  const html = buildScreenshotOverlayPage('capture-</script><img>', { id: 9 }, 'pin')
  assert.equal(html.toLowerCase().includes('data:'), false, 'overlay page must not introduce a data: navigation or asset')
  assert.equal(html.includes('capture-</script><img>'), false, 'capture metadata must be safe for inline script embedding')
  assert.match(html, /id="magnifier"/)
  assert.match(html, /id="sampleHex"/)
  assert.match(html, /id="guideX"/)
  assert.match(html, /id="screenSelect"/)
  assert.match(html, /function selectCurrentScreen\(\)/)
  assert.match(html, /nudgeSelectionRect\(rect, event\.key, pageViewport\(\), event\.shiftKey \? 10 : 1\)/)
  assert.match(html, /constrainSelectionDrag\(start, point, pageViewport\(\), constrainAspect\)/)
  assert.match(html, /buildOverlaySelectionPayload\(META, rect, renderedMetrics\(\), resolved, annotationPayload\(\)\)/)
  assert.match(html, /renderedImageRect/)
  assert.match(html, /frameSize/)
  assert.match(html, /__ttoolOverlayFrameReady/)
  assert.doesNotThrow(() => new vm.Script(pageScript(html)), 'generated page script must parse before Electron loads it')

  const page = bootPage(html)
  page.listeners.get('mousedown')(mouseEvent(100, 100, page.body))
  page.listeners.get('mousemove')(mouseEvent(300, 150, page.body, { shiftKey: true }))
  assert.equal(page.elements.guideX.classList.has('visible'), true, 'pointer movement must show crosshair guides')
  page.listeners.get('mouseup')(mouseEvent(300, 150, page.body, { shiftKey: true }))
  page.listeners.get('keydown')(keyEvent('ArrowRight'))
  page.elements.defaultButton.onclick()
  assert.equal(page.submissions.length, 1, 'page must submit through the preload bridge')
  assert.deepEqual(plain(page.submissions[0]), {
    captureId: 'capture-</script><img>',
    displayId: 9,
    rect: { x: 101, y: 100, width: 200, height: 200 },
    viewport: { width: 1200, height: 800, devicePixelRatio: 1.5 },
    renderedImageRect: { x: 10, y: 20, width: 1000, height: 600 },
    frameSize: { width: 2000, height: 1200 },
    coordinateSpace: 'overlay-css-px-v1',
    action: 'pin',
    annotations: [],
  })
  assert.equal(page.elements.sampleHex.textContent, '#0C2238', 'magnifier sampler must expose HEX')
  assert.equal(page.elements.sampleRgb.textContent, 'rgb(12, 34, 56)', 'magnifier sampler must expose RGB')
  assert.match(page.elements.sampleHsv.textContent, /^hsv\(/, 'magnifier sampler must expose HSV')

  const fullScreenPage = bootPage(html)
  fullScreenPage.elements.screenSelect.onclick()
  fullScreenPage.elements.defaultButton.onclick()
  assert.deepEqual(plain(fullScreenPage.submissions[0].rect), { x: 0, y: 0, width: 1200, height: 800 }, 'current-screen action must select the whole overlay viewport')
}

main()
console.log('screenshot overlay page tests passed')
