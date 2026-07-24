const assert = require('node:assert/strict')
const {
  captureFrozenDisplays,
  cropFrozenDisplayRegion,
  mapOverlayRectToSize,
  resolveOverlaySelection,
} = require('../electron/screenshot-freeze.cjs')

function fakeImage(width, height, label, crops) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    toDataURL: () => `data:image/png;base64,${label}`,
    crop: (rect) => {
      crops.push({ label, rect })
      return fakeImage(rect.width, rect.height, `${label}-crop`, crops)
    },
  }
}

async function main() {
  const crops = []
  const calls = []
  const desktopCapturer = {
    getSources: async (options) => {
      calls.push(options.thumbnailSize)
      return [
        { display_id: '1', thumbnail: fakeImage(options.thumbnailSize.width, options.thumbnailSize.height, 'display-1', crops) },
        { display_id: '2', thumbnail: fakeImage(options.thumbnailSize.width, options.thumbnailSize.height, 'display-2', crops) },
      ]
    },
  }
  const displays = [
    { id: 1, bounds: { width: 100, height: 50 }, scaleFactor: 2 },
    { id: 2, bounds: { width: 80, height: 60 }, scaleFactor: 1 },
  ]

  const frames = await captureFrozenDisplays(desktopCapturer, displays)
  assert.deepEqual(calls, [{ width: 200, height: 100 }, { width: 80, height: 60 }])
  assert.deepEqual(frames.get('1').image.getSize(), { width: 200, height: 100 })
  assert.deepEqual(frames.get('2').image.getSize(), { width: 80, height: 60 })
  assert.equal(Object.hasOwn(frames.get('1'), 'imageDataUrl'), false)

  const result = cropFrozenDisplayRegion(frames.get('1'), displays[0], { x: 10, y: 5, width: 30, height: 20 })
  assert.deepEqual(crops[0], { label: 'display-1', rect: { x: 20, y: 10, width: 60, height: 40 } })
  assert.deepEqual(result, { imageDataUrl: 'data:image/png;base64,display-1-crop', width: 60, height: 40 })

  const scaledDisplay = { id: 3, bounds: { width: 1280, height: 720 }, scaleFactor: 1.5 }
  const viewport = { width: 1024, height: 576 }
  const selection = { x: 256, y: 144, width: 512, height: 288 }
  assert.deepEqual(mapOverlayRectToSize(selection, viewport, { width: 1920, height: 1080 }), {
    x: 480,
    y: 270,
    width: 960,
    height: 540,
  })
  assert.deepEqual(resolveOverlaySelection(scaledDisplay, selection, viewport), {
    rect: selection,
    viewport,
    displayRect: { x: 320, y: 180, width: 640, height: 360 },
  })

  const scaledFrame = { image: fakeImage(1920, 1080, 'display-3', crops) }
  const scaledResult = cropFrozenDisplayRegion(scaledFrame, scaledDisplay, selection, viewport)
  assert.deepEqual(crops[1], { label: 'display-3', rect: { x: 480, y: 270, width: 960, height: 540 } })
  assert.deepEqual(scaledResult, { imageDataUrl: 'data:image/png;base64,display-3-crop', width: 960, height: 540 })

  const clipped = resolveOverlaySelection(scaledDisplay, { x: -20, y: 560, width: 80, height: 40 }, viewport)
  assert.deepEqual(clipped, {
    rect: { x: 0, y: 560, width: 60, height: 16 },
    viewport,
    displayRect: { x: 0, y: 700, width: 75, height: 20 },
  })
}

main().then(() => console.log('screenshot freeze tests passed'))
