const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const {
  CLAMP_EDGE,
  CLAMP_NONE,
  PIXEL_ROUND_COVER,
  createCaptureFrame,
  createCoordinateTransform,
  matchDisplaySource,
} = require('../electron/screenshot-capture-core.cjs')

function fakeImage(width, height, label, crops = [], pngCalls = []) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    toPNG: () => {
      pngCalls.push(label)
      return Buffer.from(`png:${label}`)
    },
    toDataURL: () => `data:image/png;base64,${label}`,
    crop: (rect) => {
      crops.push({ label, rect })
      return fakeImage(rect.width, rect.height, `${label}-crop`, crops, pngCalls)
    },
  }
}

function assertPoint(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual.x - expected.x) <= epsilon, `x: expected ${expected.x}, received ${actual.x}`)
  assert.ok(Math.abs(actual.y - expected.y) <= epsilon, `y: expected ${expected.y}, received ${actual.y}`)
}

function testStrictDisplayMatching() {
  const wrong = { id: 'wrong', display_id: '8' }
  const expected = { id: 'expected', display_id: '7' }
  assert.equal(matchDisplaySource([wrong, expected], { id: 7 }), expected)
  assert.throws(
    () => matchDisplaySource([wrong], { id: 7 }),
    (error) => error.code === 'ERR_SCREEN_SOURCE_NOT_FOUND',
  )
  assert.throws(
    () => matchDisplaySource([expected, { ...expected, id: 'duplicate' }], { id: 7 }),
    (error) => error.code === 'ERR_SCREEN_SOURCE_AMBIGUOUS',
  )
}

function testImmutableCaptureFrame() {
  const crops = []
  const pngCalls = []
  const image = fakeImage(800, 400, 'display-7', crops, pngCalls)
  const frame = createCaptureFrame({
    display: {
      id: 7,
      bounds: { x: -800, y: -100, width: 400, height: 200 },
      scaleFactor: 2,
      rotation: 180,
    },
    source: { id: 'screen:7:0', display_id: '7', thumbnail: image },
  })

  assert.equal(Object.isFrozen(frame), true)
  assert.equal(Object.isFrozen(frame.screenDipRect), true)
  assert.equal(Object.isFrozen(frame.pixelSize), true)
  assert.equal(Object.isFrozen(frame.image), true)
  assert.deepEqual(frame.pixelSize, { width: 800, height: 400 })
  assert.equal(frame.displayRotation, 180)
  assert.equal(frame.rotation, 0, 'desktopCapturer PNG is display-oriented unless frameRotation is explicit')
  assert.deepEqual(pngCalls, ['display-7'], 'PNG must be encoded exactly once')

  const canonical = Buffer.from('png:display-7')
  assert.equal(frame.pngSha256, crypto.createHash('sha256').update(canonical).digest('hex'))
  const mutableCopy = frame.toPNG()
  mutableCopy.fill(0)
  assert.deepEqual(frame.toPNG(), canonical, 'mutating a returned PNG copy must not change the canonical frame')
  assert.deepEqual(frame.image.toPNG(), canonical, 'legacy image.toPNG must return the same canonical PNG bytes')
  assert.notEqual(frame.toPNG(), frame.toPNG(), 'callers must not receive the private canonical Buffer')

  const cropped = frame.crop({ x: 20, y: 10, width: 100, height: 50 })
  assert.deepEqual(crops, [{ label: 'display-7', rect: { x: 20, y: 10, width: 100, height: 50 } }])
  assert.deepEqual(cropped.getSize(), { width: 100, height: 50 })
  assert.throws(
    () => frame.crop({ x: 20.25, y: 10, width: 100, height: 50 }),
    (error) => error.code === 'ERR_CAPTURE_CROP',
  )
  assert.throws(
    () => createCaptureFrame({
      display: { id: 8, bounds: { x: 0, y: 0, width: 400, height: 200 } },
      source: { display_id: '7', thumbnail: image },
    }),
    (error) => error.code === 'ERR_CAPTURE_FRAME_DISPLAY_MISMATCH',
  )
}

function testScaleAndNegativeOriginTransforms() {
  const scales = [1, 1.25, 1.5, 1.75, 2]
  for (const scale of scales) {
    const transform = createCoordinateTransform({
      screenDipRect: { x: -1600, y: -800, width: 1600, height: 800 },
      overlayViewport: { width: 1000, height: 500 },
      renderedImageRect: { x: 0, y: 0, width: 1000, height: 500 },
      framePixelSize: { width: 1600 * scale, height: 800 * scale },
      rotation: 0,
    })
    const screenPoint = { x: -1200, y: -600 }
    const overlayPoint = transform.screenDipToOverlayCss(screenPoint, { clamp: CLAMP_NONE })
    assertPoint(overlayPoint, { x: 250, y: 125 })
    assertPoint(transform.overlayCssToScreenDip(overlayPoint, { clamp: CLAMP_NONE }), screenPoint)
    assertPoint(transform.screenDipToFramePixel(screenPoint, { clamp: CLAMP_NONE }), {
      x: 400 * scale,
      y: 200 * scale,
    })
    assert.deepEqual(
      transform.overlayCssRectToFramePixels(
        { x: 250, y: 125, width: 500, height: 250 },
        { clamp: CLAMP_EDGE, rounding: PIXEL_ROUND_COVER },
      ),
      { x: 400 * scale, y: 200 * scale, width: 800 * scale, height: 400 * scale },
      `unexpected crop at ${scale * 100}% scaling`,
    )
  }
}

function testRenderedImageRectAndPortraitRotation() {
  const transform = createCoordinateTransform({
    screenDipRect: { x: -1080, y: 0, width: 1080, height: 1920 },
    overlayViewport: { x: 0, y: 0, width: 1180, height: 1920 },
    renderedImageRect: { x: 50, y: 0, width: 1080, height: 1920 },
    framePixelSize: { width: 1920, height: 1080 },
    rotation: 90,
  })

  assertPoint(transform.overlayCssToFramePixel({ x: 50, y: 0 }, { clamp: CLAMP_EDGE }), { x: 0, y: 1080 })
  assertPoint(transform.overlayCssToFramePixel({ x: 1130, y: 0 }, { clamp: CLAMP_EDGE }), { x: 0, y: 0 })
  assertPoint(transform.overlayCssToFramePixel({ x: 1130, y: 1920 }, { clamp: CLAMP_EDGE }), { x: 1920, y: 0 })
  assertPoint(transform.framePixelToOverlayCss({ x: 0, y: 1080 }, { clamp: CLAMP_EDGE }), { x: 50, y: 0 })
  assert.deepEqual(
    transform.overlayCssRectToFramePixels(
      { x: 50, y: 0, width: 1080, height: 1920 },
      { clamp: CLAMP_EDGE, rounding: PIXEL_ROUND_COVER },
    ),
    { x: 0, y: 0, width: 1920, height: 1080 },
  )
  assert.deepEqual(
    transform.framePixelsRectToOverlayCss(
      { x: 0, y: 0, width: 1920, height: 1080 },
      { clamp: CLAMP_EDGE },
    ),
    { x: 50, y: 0, width: 1080, height: 1920 },
  )

  assert.throws(
    () => createCoordinateTransform({
      screenDipRect: { x: 0, y: 0, width: 1080, height: 1920 },
      overlayViewport: { width: 1080, height: 1920 },
      framePixelSize: { width: 1920, height: 1080 },
      rotation: 0,
    }),
    (error) => error.code === 'ERR_CAPTURE_ASPECT',
  )
  assert.throws(
    () => createCoordinateTransform({
      screenDipRect: { x: 0, y: 0, width: 100, height: 50 },
      overlayViewport: { width: 100, height: 50 },
      framePixelSize: { width: 200, height: 100 },
      rotation: 45,
    }),
    (error) => error.code === 'ERR_CAPTURE_ROTATION',
  )

  for (const rotation of [0, 90, 180, 270]) {
    const framePixelSize = rotation === 90 || rotation === 270
      ? { width: 200, height: 100 }
      : { width: 100, height: 200 }
    const roundTrip = createCoordinateTransform({
      screenDipRect: { x: -50, y: -100, width: 100, height: 200 },
      overlayViewport: { width: 100, height: 200 },
      framePixelSize,
      rotation,
    })
    const framePoint = { x: framePixelSize.width * 0.2, y: framePixelSize.height * 0.7 }
    assertPoint(
      roundTrip.overlayCssToFramePixel(
        roundTrip.framePixelToOverlayCss(framePoint, { clamp: CLAMP_NONE }),
        { clamp: CLAMP_NONE },
      ),
      framePoint,
    )
  }
}

function testExplicitEdgeClamps() {
  const transform = createCoordinateTransform({
    screenDipRect: { x: -100, y: -50, width: 100, height: 50 },
    overlayViewport: { x: 0, y: 0, width: 220, height: 140 },
    renderedImageRect: { x: 10, y: 20, width: 200, height: 100 },
    framePixelSize: { width: 200, height: 100 },
    rotation: 0,
  })

  assertPoint(transform.overlayCssToFramePixel({ x: 0, y: 0 }, { clamp: CLAMP_NONE }), { x: -10, y: -20 })
  assertPoint(transform.overlayCssToFramePixel({ x: 0, y: 0 }, { clamp: CLAMP_EDGE }), { x: 0, y: 0 })
  assert.deepEqual(
    transform.overlayCssRectToFramePixels(
      { x: -10, y: 10, width: 70, height: 40 },
      { clamp: CLAMP_EDGE, rounding: PIXEL_ROUND_COVER },
    ),
    { x: 0, y: 0, width: 50, height: 30 },
  )
  assert.deepEqual(
    transform.overlayCssRectToFramePixels(
      { x: 190, y: 100, width: 40, height: 40 },
      { clamp: CLAMP_EDGE, rounding: PIXEL_ROUND_COVER },
    ),
    { x: 180, y: 80, width: 20, height: 20 },
  )
  assert.deepEqual(
    transform.overlayCssRectToFramePixels(
      { x: 500, y: 500, width: 20, height: 20 },
      { clamp: CLAMP_EDGE, rounding: PIXEL_ROUND_COVER },
    ),
    { x: 200, y: 100, width: 0, height: 0 },
    'an out-of-frame selection must not fabricate a one-pixel crop',
  )
}

testStrictDisplayMatching()
testImmutableCaptureFrame()
testScaleAndNegativeOriginTransforms()
testRenderedImageRectAndPortraitRotation()
testExplicitEdgeClamps()
console.log('screenshot capture core tests passed')
