'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { overlayFrameReceiverScript } = require('../electron/screenshot-overlay-frame.cjs')
const { normalizePinState } = require('../electron/screenshot-pin-state.cjs')

const root = path.join(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')
const types = fs.readFileSync(path.join(root, 'src', 'platform', 'types.ts'), 'utf8')

function has(source, pattern, message) {
  assert.match(source, pattern, message)
}

has(main, /buildScreenshotOverlayPage\(captureId, display, action\)/, 'active overlay must use the dedicated page builder')
has(main, /useContentSize:\s*true[\s\S]*?const png = frozenFrame\.toPNG\(\)/, 'overlay content bounds and canonical frame bytes must stay coupled')
has(main, /cropFrozenDisplayRegion\(frozenFrame, display, rect, viewport, contract\.renderedImageRect\)/, 'crop must consume the actual rendered-image rectangle')
has(main, /coordinateSpace !== 'overlay-css-px-v1'/, 'main process must reject stale selection coordinate contracts')
has(main, /Number\(frameSize && frameSize\.width\) !== expectedFrameSize\.width/, 'main process must verify the frame shown by the overlay')

has(main, /createScreenshotHistory\(path\.join\(app\.getPath\('userData'\), 'screenshot-history'\)\)/, 'history must be rooted under app userData')
has(main, /setScreenshotFavorite[\s\S]*restoreScreenshot[\s\S]*quickSaveScreenshot/, 'history favorite, restore, and quick-save wiring is incomplete')
has(main, /atomicWritePinFile\(pinImageFile\(id\), png\)/, 'new pins must persist canonical PNG bytes')
has(main, /restorePersistedPins\(\)/, 'persisted pins must be restored at startup')
has(main, /loadOverlayWithFrame\(pin\.window, pinHtml\(pin\)/, 'pin windows must receive pixels over the bounded binary frame bridge')
assert.doesNotMatch(main, /let imageDataUrl = \$\{image\}/, 'pin HTML must not embed unbounded image data in its navigation URL')

const pinHtmlStart = main.indexOf('function pinHtml(')
const pinHtmlEnd = main.indexOf('\nfunction pinVisualAspect(', pinHtmlStart)
assert.ok(pinHtmlStart >= 0 && pinHtmlEnd > pinHtmlStart, 'pin page builder source could not be isolated')
const pinSandbox = { normalizePinState, overlayFrameReceiverScript, generatedPinPage: '' }
vm.runInNewContext(`${main.slice(pinHtmlStart, pinHtmlEnd)}\ngeneratedPinPage = pinHtml({ id: 'pin_contract_test', displayId: 7, state: {} })`, pinSandbox)
const pinPage = pinSandbox.generatedPinPage
assert.ok(pinPage.length < 100_000, `pin navigation page is unexpectedly large: ${pinPage.length}`)
assert.match(pinPage, /id="frozenFrame"/, 'pin page must expose the binary frame receiver target')
assert.match(pinPage, /updatePinState/, 'pin page must wire state controls')
assert.match(pinPage, /opacityBy[\s\S]*zoomBy/, 'pin wheel controls must cover opacity and zoom')
const inlineScript = pinPage.match(/<script>([\s\S]*?)<\/script>/)
assert.ok(inlineScript, 'pin page inline script is missing')
new vm.Script(inlineScript[1], { filename: 'generated-screenshot-pin-page.js' })

for (const method of [
  'listHistory',
  'getHistoryItem',
  'historyStats',
  'setScreenshotFavorite',
  'restoreScreenshot',
  'quickSaveScreenshot',
  'updatePinState',
  'copyPin',
  'savePin',
]) {
  has(preload, new RegExp(method + ':\\s*\\('), `preload is missing ${method}`)
  has(types, new RegExp('\\b' + method + '\\('), `ScreenshotApi is missing ${method}`)
}

console.log('screenshot main integration contract tests passed')
