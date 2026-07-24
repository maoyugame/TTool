const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function processIsAbsent(pid) {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    if (error && error.code === 'ESRCH') return true
    throw error
  }
}

async function waitForProcessesToExit(pids) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const remaining = pids.filter((pid) => !processIsAbsent(pid))
    if (!remaining.length) return []
    await delay(100)
  }
  return pids.filter((pid) => !processIsAbsent(pid))
}

function mapRectBetweenSizes(rect, source, target) {
  const left = Math.round(rect.x * target.width / source.width)
  const top = Math.round(rect.y * target.height / source.height)
  const right = Math.round((rect.x + rect.width) * target.width / source.width)
  const bottom = Math.round((rect.y + rect.height) * target.height / source.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

async function runParent() {
  const { spawn } = require('node:child_process')
  const electron = require('electron')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ttool-screenshot-coordinate-test-'))
  const userData = path.join(tempRoot, 'user-data')
  const resultPath = path.join(tempRoot, 'result.json')
  fs.mkdirSync(userData)
  let child = null

  try {
    child = spawn(electron, [__filename], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        TTOOL_SCREENSHOT_COORDINATE_TEST_CHILD: '1',
        TTOOL_SCREENSHOT_COORDINATE_TEST_USER_DATA: userData,
        TTOOL_SCREENSHOT_COORDINATE_TEST_RESULT: resultPath,
      },
      stdio: 'inherit',
      windowsHide: true,
    })

    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error('Screenshot coordinate regression timed out'))
      }, 45_000)
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)
        resolve(code)
      })
    })

    assert.equal(exitCode, 0, `Screenshot coordinate regression failed with exit code ${exitCode}`)
    assert.equal(fs.existsSync(resultPath), true, 'Screenshot coordinate regression did not write evidence')
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    assert.equal(result.viewport.width, 1024)
    assert.ok(result.viewport.height >= 575 && result.viewport.height <= 578, `Unexpected hidden overlay height ${result.viewport.height}`)
    assert.deepEqual(result.selection, { x: 256, y: 144, width: 512, height: 288 })
    const expectedCrop = mapRectBetweenSizes(result.selection, result.viewport, { width: 1920, height: 1080 })
    const expectedDisplayRect = mapRectBetweenSizes(result.selection, result.viewport, { width: 1280, height: 720 })
    const legacyCrop = mapRectBetweenSizes(result.selection, { width: 1280, height: 720 }, { width: 1920, height: 1080 })
    assert.deepEqual(result.cropRect, expectedCrop)
    assert.deepEqual(result.displayRect, expectedDisplayRect)
    assert.notDeepEqual(result.cropRect, legacyCrop, 'Fixture must distinguish viewport-aware mapping from the legacy display-bounds mapping')
    assert.ok(result.devicePixelRatio > 1, `Expected a scaled Chromium renderer, got DPR ${result.devicePixelRatio}`)

    const remainingPids = await waitForProcessesToExit(result.ownedPids)
    assert.deepEqual(remainingPids, [], `Test-owned Electron processes are still running: ${remainingPids.join(', ')}`)
    console.log(`screenshot overlay coordinate test passed (DPR ${result.devicePixelRatio})`)
  } finally {
    if (child && child.exitCode === null) child.kill()
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    assert.equal(fs.existsSync(tempRoot), false, `Test temporary directory still exists: ${tempRoot}`)
  }
}

async function runElectronChild() {
  const { app, BrowserWindow } = require('electron')
  const { cropFrozenDisplayRegion, resolveOverlaySelection } = require('../electron/screenshot-freeze.cjs')

  app.commandLine.appendSwitch('force-device-scale-factor', '1.5')
  app.setName('ttool-screenshot-coordinate-test')
  app.setPath('userData', process.env.TTOOL_SCREENSHOT_COORDINATE_TEST_USER_DATA)

  try {
    await app.whenReady()
    const win = new BrowserWindow({
      width: 1024,
      height: 576,
      frame: false,
      show: false,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#frozenFrame{position:fixed;inset:0;width:100%;height:100%;object-fit:fill}</style></head><body><div id="frozenFrame"></div><script>
let start = null;
window.__selection = null;
addEventListener('mousedown', (event) => { start = { x: event.clientX, y: event.clientY }; });
addEventListener('mouseup', (event) => {
  if (!start) return;
  window.__selection = {
    x: Math.min(start.x, event.clientX),
    y: Math.min(start.y, event.clientY),
    width: Math.abs(event.clientX - start.x),
    height: Math.abs(event.clientY - start.y),
  };
  start = null;
});
</script></body></html>`
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    win.webContents.focus()
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 256, y: 144, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 768, y: 432, movementX: 512, movementY: 288 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 768, y: 432, button: 'left', clickCount: 1 })
    await delay(50)

    const renderer = await win.webContents.executeJavaScript(`({
      selection: window.__selection,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
    })`)
    assert.ok(renderer.selection, 'Targeted Electron pointer input did not produce a selection')

    const display = { id: 1, bounds: { width: 1280, height: 720 }, scaleFactor: 1.5 }
    const resolved = resolveOverlaySelection(display, renderer.selection, renderer.viewport)
    let cropRect = null
    const frame = {
      image: {
        isEmpty: () => false,
        getSize: () => ({ width: 1920, height: 1080 }),
        crop: (rect) => {
          cropRect = rect
          return {
            getSize: () => ({ width: rect.width, height: rect.height }),
            toDataURL: () => 'data:image/png;base64,coordinate-test',
          }
        },
      },
    }
    cropFrozenDisplayRegion(frame, display, resolved.rect, resolved.viewport)

    const ownedPids = [...new Set([process.pid, ...app.getAppMetrics().map((metric) => metric.pid)])]
    fs.writeFileSync(process.env.TTOOL_SCREENSHOT_COORDINATE_TEST_RESULT, JSON.stringify({
      viewport: renderer.viewport,
      selection: renderer.selection,
      cropRect,
      displayRect: resolved.displayRect,
      devicePixelRatio: renderer.devicePixelRatio,
      ownedPids,
    }))
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}

if (process.versions.electron && process.env.TTOOL_SCREENSHOT_COORDINATE_TEST_CHILD === '1') {
  void runElectronChild()
} else {
  runParent().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
