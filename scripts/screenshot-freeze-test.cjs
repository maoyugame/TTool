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
    toPNG: () => Buffer.from(`png:${label}`),
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
  assert.equal(Object.isFrozen(frames.get('1')), true)
  assert.deepEqual(frames.get('1').toPNG(), Buffer.from('png:display-1'))

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

  const renderedFrame = { image: fakeImage(200, 100, 'display-rendered', crops) }
  const renderedDisplay = { id: 4, bounds: { x: -100, y: -50, width: 100, height: 50 }, scaleFactor: 2 }
  const renderedResult = cropFrozenDisplayRegion(
    renderedFrame,
    renderedDisplay,
    { x: 10, y: 20, width: 100, height: 50 },
    { width: 220, height: 140 },
    { x: 10, y: 20, width: 200, height: 100 },
  )
  assert.deepEqual(crops[2], { label: 'display-rendered', rect: { x: 0, y: 0, width: 100, height: 50 } })
  assert.deepEqual(renderedResult, { imageDataUrl: 'data:image/png;base64,display-rendered-crop', width: 100, height: 50 })
  assert.throws(
    () => cropFrozenDisplayRegion(
      renderedFrame,
      renderedDisplay,
      { x: 500, y: 500, width: 20, height: 20 },
      { width: 220, height: 140 },
      { x: 10, y: 20, width: 200, height: 100 },
    ),
    (error) => error.code === 'ERR_CAPTURE_CROP_EMPTY',
  )

  const clipped = resolveOverlaySelection(scaledDisplay, { x: -20, y: 560, width: 80, height: 40 }, viewport)
  assert.deepEqual(clipped, {
    rect: { x: 0, y: 560, width: 60, height: 16 },
    viewport,
    displayRect: { x: 0, y: 700, width: 75, height: 20 },
  })

  const scaleFactors = [1, 1.25, 1.5, 1.75, 2]
  const scaleDisplays = scaleFactors.map((scaleFactor, index) => ({
    id: 100 + index,
    bounds: { x: index % 2 ? -1600 : 0, y: index % 2 ? -800 : 0, width: 1600, height: 800 },
    scaleFactor,
  }))
  const scaleCalls = []
  const scaleFrames = await captureFrozenDisplays({
    getSources: async (options) => {
      scaleCalls.push(options.thumbnailSize)
      return [
        { display_id: '999', thumbnail: fakeImage(1, 1, 'wrong-first-source', crops) },
        ...scaleDisplays.map((display) => ({
          display_id: String(display.id),
          thumbnail: fakeImage(options.thumbnailSize.width, options.thumbnailSize.height, `display-${display.id}`, crops),
        })),
      ]
    },
  }, scaleDisplays)
  assert.deepEqual(scaleCalls, scaleFactors.map((scaleFactor) => ({
    width: 1600 * scaleFactor,
    height: 800 * scaleFactor,
  })))
  for (const [index, display] of scaleDisplays.entries()) {
    assert.deepEqual(scaleFrames.get(String(display.id)).pixelSize, scaleCalls[index])
    assert.equal(scaleFrames.get(String(display.id)).sourceDisplayId, String(display.id))
  }

  await assert.rejects(
    () => captureFrozenDisplays({
      getSources: async () => [{ display_id: '999', thumbnail: fakeImage(1600, 800, 'wrong-only-source', crops) }],
    }, [scaleDisplays[0]]),
    (error) => error.code === 'ERR_SCREEN_SOURCE_NOT_FOUND',
  )
  await assert.rejects(
    () => captureFrozenDisplays({
      getSources: async () => [
        { display_id: '100', thumbnail: fakeImage(1600, 800, 'duplicate-a', crops) },
        { display_id: 100, thumbnail: fakeImage(1600, 800, 'duplicate-b', crops) },
      ],
    }, [scaleDisplays[0]]),
    (error) => error.code === 'ERR_SCREEN_SOURCE_AMBIGUOUS',
  )
}

main().then(() => console.log('screenshot freeze tests passed'))
