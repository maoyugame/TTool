const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CHROMIUM_URL_LIMIT = 2 * 1024 * 1024

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

async function runParent() {
  const { spawn } = require('node:child_process')
  const electron = require('electron')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ttool-screenshot-overlay-test-'))
  const userData = path.join(tempRoot, 'user-data')
  const resultPath = path.join(tempRoot, 'result.json')
  fs.mkdirSync(userData)
  let child = null

  try {
    child = spawn(electron, [__filename], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        TTOOL_SCREENSHOT_OVERLAY_TEST_CHILD: '1',
        TTOOL_SCREENSHOT_OVERLAY_TEST_USER_DATA: userData,
        TTOOL_SCREENSHOT_OVERLAY_TEST_RESULT: resultPath,
      },
      stdio: 'inherit',
      windowsHide: true,
    })

    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error('Screenshot overlay regression timed out'))
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

    assert.equal(exitCode, 0, `Screenshot overlay regression failed with exit code ${exitCode}`)
    assert.equal(fs.existsSync(resultPath), true, 'Screenshot overlay regression did not write evidence')
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    assert.ok(result.pngByteLength > CHROMIUM_URL_LIMIT, 'Regression PNG must exceed Chromium URL limit')
    assert.ok(result.legacyNavigationUrlLength > CHROMIUM_URL_LIMIT, 'Legacy navigation URL must reproduce the old failure size')
    assert.ok(result.navigationUrlLength < CHROMIUM_URL_LIMIT, 'Fixed overlay navigation URL must stay bounded')
    assert.equal(result.frameSource, 'blob')
    assert.equal(result.frameWidth, 1280)
    assert.equal(result.frameHeight, 1024)

    const remainingPids = await waitForProcessesToExit(result.ownedPids)
    assert.deepEqual(remainingPids, [], `Test-owned Electron processes are still running: ${remainingPids.join(', ')}`)
    console.log(`screenshot overlay oversized-frame test passed (${result.pngByteLength} byte PNG, ${result.navigationUrlLength} char navigation URL)`)
  } finally {
    if (child && child.exitCode === null) child.kill()
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

function deterministicBitmap(width, height) {
  const bitmap = Buffer.allocUnsafe(width * height * 4)
  let state = 0x13579bdf
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    bitmap[offset] = state & 0xff
    bitmap[offset + 1] = (state >>> 8) & 0xff
    bitmap[offset + 2] = (state >>> 16) & 0xff
    bitmap[offset + 3] = 0xff
  }
  return bitmap
}

async function runElectronChild() {
  const { app, BrowserWindow, nativeImage } = require('electron')
  const {
    loadOverlayWithFrame,
    overlayFrameReceiverScript,
    overlayNavigationUrl,
  } = require('../electron/screenshot-overlay-frame.cjs')

  app.setName('ttool-screenshot-overlay-test')
  app.setPath('userData', process.env.TTOOL_SCREENSHOT_OVERLAY_TEST_USER_DATA)

  try {
    await app.whenReady()
    const win = new BrowserWindow({
      width: 192,
      height: 128,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    const width = 1280
    const height = 1024
    const image = nativeImage.createFromBitmap(deterministicBitmap(width, height), { width, height, scaleFactor: 1 })
    const png = image.toPNG()
    assert.ok(png.length > CHROMIUM_URL_LIMIT, `Generated PNG is too small: ${png.length}`)

    const meta = { captureId: 'oversized-frame-test', displayId: 1, defaultAction: 'edit' }
    const html = `<!doctype html><html><body style="margin:0;background:#000"><img id="frozenFrame" alt="" style="width:100vw;height:100vh;object-fit:fill"><script>const META=${JSON.stringify(meta)};${overlayFrameReceiverScript()}</script></body></html>`
    const legacyHtml = `<!doctype html><img src=${JSON.stringify(image.toDataURL())}>`
    const legacyNavigationUrlLength = overlayNavigationUrl(legacyHtml).length
    assert.ok(legacyNavigationUrlLength > CHROMIUM_URL_LIMIT)

    const { ready, navigationUrlLength } = loadOverlayWithFrame(win, html, {
      captureId: meta.captureId,
      displayId: meta.displayId,
      png,
    })
    assert.ok(navigationUrlLength < CHROMIUM_URL_LIMIT)
    const frame = await ready
    assert.equal(frame.width, width)
    assert.equal(frame.height, height)
    assert.equal(frame.byteLength, png.length)
    assert.equal(frame.source, 'blob')

    const rendered = await win.webContents.executeJavaScript(`(() => { const image = document.getElementById('frozenFrame'); return { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight, source: image.src.slice(0, 5) } })()`)
    assert.deepEqual(rendered, { complete: true, width, height, source: 'blob:' })
    const capture = await win.capturePage(undefined, { stayHidden: true })
    assert.equal(capture.isEmpty(), false, 'Hidden overlay render capture is empty')

    const ownedPids = [...new Set([process.pid, ...app.getAppMetrics().map((metric) => metric.pid)])]
    fs.writeFileSync(process.env.TTOOL_SCREENSHOT_OVERLAY_TEST_RESULT, JSON.stringify({
      pngByteLength: png.length,
      legacyNavigationUrlLength,
      navigationUrlLength,
      frameSource: frame.source,
      frameWidth: frame.width,
      frameHeight: frame.height,
      ownedPids,
    }))
    console.log(`OVERLAY_FRAME_LOADED ${png.length} ${navigationUrlLength}`)
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}

if (process.versions.electron && process.env.TTOOL_SCREENSHOT_OVERLAY_TEST_CHILD === '1') {
  void runElectronChild()
} else {
  runParent().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
