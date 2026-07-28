const crypto = require('node:crypto')

const CAPTURE_FRAME_KIND = 'ttool.capture-frame'
const CAPTURE_FRAME_VERSION = 1
const CLAMP_NONE = 'none'
const CLAMP_EDGE = 'edge'
const PIXEL_ROUND_NONE = 'none'
const PIXEL_ROUND_COVER = 'cover'
const PIXEL_ROUND_NEAREST = 'nearest'
const VALID_ROTATIONS = new Set([0, 90, 180, 270])
const DEFAULT_ASPECT_TOLERANCE = 0.01
const FLOAT_EPSILON = 1e-9

function contractError(ErrorType, code, message) {
  const error = new ErrorType(message)
  error.code = code
  return error
}

function finiteNumber(value, name) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw contractError(TypeError, 'ERR_CAPTURE_COORDINATE', `${name} must be a finite number`)
  }
  return number
}

function positiveNumber(value, name) {
  const number = finiteNumber(value, name)
  if (number <= 0) {
    throw contractError(RangeError, 'ERR_CAPTURE_DIMENSION', `${name} must be greater than zero`)
  }
  return number
}

function normalizeIdentity(value, name) {
  if (value === undefined || value === null || String(value) === '') {
    throw contractError(TypeError, 'ERR_CAPTURE_IDENTITY', `${name} is required`)
  }
  return String(value)
}

function normalizeSize(value, name) {
  if (!value || typeof value !== 'object') {
    throw contractError(TypeError, 'ERR_CAPTURE_DIMENSION', `${name} is required`)
  }
  return Object.freeze({
    width: positiveNumber(value.width, `${name}.width`),
    height: positiveNumber(value.height, `${name}.height`),
  })
}

function normalizePositiveRect(value, name) {
  if (!value || typeof value !== 'object') {
    throw contractError(TypeError, 'ERR_CAPTURE_RECT', `${name} is required`)
  }
  return Object.freeze({
    x: finiteNumber(value.x === undefined ? 0 : value.x, `${name}.x`),
    y: finiteNumber(value.y === undefined ? 0 : value.y, `${name}.y`),
    width: positiveNumber(value.width, `${name}.width`),
    height: positiveNumber(value.height, `${name}.height`),
  })
}

function normalizeRectEdges(value, name) {
  if (!value || typeof value !== 'object') {
    throw contractError(TypeError, 'ERR_CAPTURE_RECT', `${name} is required`)
  }
  const x1 = finiteNumber(value.x === undefined ? 0 : value.x, `${name}.x`)
  const y1 = finiteNumber(value.y === undefined ? 0 : value.y, `${name}.y`)
  const x2 = x1 + finiteNumber(value.width, `${name}.width`)
  const y2 = y1 + finiteNumber(value.height, `${name}.height`)
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  }
}

function rectFromEdges(edges) {
  return {
    x: edges.left,
    y: edges.top,
    width: edges.right - edges.left,
    height: edges.bottom - edges.top,
  }
}

function normalizeRotation(value, name = 'rotation') {
  const rotation = finiteNumber(value === undefined ? 0 : value, name)
  if (!VALID_ROTATIONS.has(rotation)) {
    throw contractError(RangeError, 'ERR_CAPTURE_ROTATION', `${name} must be one of 0, 90, 180, or 270`)
  }
  return rotation
}

function rotatedSize(size, rotation) {
  return rotation === 90 || rotation === 270
    ? Object.freeze({ width: size.height, height: size.width })
    : Object.freeze({ width: size.width, height: size.height })
}

function aspectRelativeError(left, right) {
  const leftRatio = left.width / left.height
  const rightRatio = right.width / right.height
  return Math.abs(leftRatio - rightRatio) / Math.max(leftRatio, rightRatio)
}

function assertAspectCompatible(leftValue, rightValue, options = {}) {
  const left = normalizeSize(leftValue, options.leftName || 'leftSize')
  const right = normalizeSize(rightValue, options.rightName || 'rightSize')
  const tolerance = finiteNumber(
    options.tolerance === undefined ? DEFAULT_ASPECT_TOLERANCE : options.tolerance,
    'aspectTolerance',
  )
  if (tolerance < 0 || tolerance >= 1) {
    throw contractError(RangeError, 'ERR_CAPTURE_ASPECT_TOLERANCE', 'aspectTolerance must be in [0, 1)')
  }
  const relativeError = aspectRelativeError(left, right)
  if (relativeError > tolerance) {
    throw contractError(
      RangeError,
      'ERR_CAPTURE_ASPECT',
      `${options.leftName || 'leftSize'} and ${options.rightName || 'rightSize'} aspect ratios differ by ${(relativeError * 100).toFixed(3)}%`,
    )
  }
  return Object.freeze({ relativeError, tolerance })
}

function matchDisplaySource(sources, display) {
  if (!Array.isArray(sources)) {
    throw contractError(TypeError, 'ERR_SCREEN_SOURCE_LIST', 'desktopCapturer sources must be an array')
  }
  const displayId = normalizeIdentity(display && display.id, 'display.id')
  const matches = sources.filter((source) => (
    source
    && source.display_id !== undefined
    && source.display_id !== null
    && String(source.display_id) === displayId
  ))
  if (matches.length === 0) {
    throw contractError(Error, 'ERR_SCREEN_SOURCE_NOT_FOUND', `未找到显示器 ${displayId} 对应的截图源`)
  }
  if (matches.length !== 1) {
    throw contractError(Error, 'ERR_SCREEN_SOURCE_AMBIGUOUS', `显示器 ${displayId} 匹配到多个截图源`)
  }
  return matches[0]
}

function pngBuffer(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw contractError(TypeError, 'ERR_CAPTURE_PNG', 'CaptureFrame PNG must be a Buffer or Uint8Array')
  }
  const result = Buffer.from(value)
  if (!result.length) {
    throw contractError(Error, 'ERR_CAPTURE_PNG_EMPTY', 'CaptureFrame PNG is empty')
  }
  return result
}

function normalizePixelCrop(rect, pixelSize) {
  const edges = normalizeRectEdges(rect, 'cropRect')
  const integerEdges = {
    left: Math.round(edges.left),
    top: Math.round(edges.top),
    right: Math.round(edges.right),
    bottom: Math.round(edges.bottom),
  }
  const values = Object.values(integerEdges)
  const originalValues = [edges.left, edges.top, edges.right, edges.bottom]
  if (
    values.some((value) => !Number.isSafeInteger(value))
    || originalValues.some((value, index) => Math.abs(value - values[index]) > FLOAT_EPSILON)
  ) {
    throw contractError(RangeError, 'ERR_CAPTURE_CROP', 'cropRect must use safe integer pixel edges')
  }
  if (
    integerEdges.left < 0
    || integerEdges.top < 0
    || integerEdges.right > pixelSize.width
    || integerEdges.bottom > pixelSize.height
    || integerEdges.right <= integerEdges.left
    || integerEdges.bottom <= integerEdges.top
  ) {
    throw contractError(RangeError, 'ERR_CAPTURE_CROP', 'cropRect must be a non-empty rectangle inside CaptureFrame pixels')
  }
  return rectFromEdges(integerEdges)
}

function createCaptureFrame(options) {
  if (!options || typeof options !== 'object') {
    throw contractError(TypeError, 'ERR_CAPTURE_FRAME', 'CaptureFrame options are required')
  }
  const display = options.display
  const source = options.source
  const image = options.image || (source && source.thumbnail)
  const displayId = normalizeIdentity(display && display.id, 'display.id')
  const sourceDisplayId = normalizeIdentity(source && source.display_id, 'source.display_id')
  if (displayId !== sourceDisplayId) {
    throw contractError(Error, 'ERR_CAPTURE_FRAME_DISPLAY_MISMATCH', `截图源 ${sourceDisplayId} 不属于显示器 ${displayId}`)
  }
  if (!image || typeof image.getSize !== 'function' || typeof image.crop !== 'function') {
    throw contractError(TypeError, 'ERR_CAPTURE_IMAGE', 'CaptureFrame image is invalid')
  }
  if (typeof image.isEmpty === 'function' && image.isEmpty()) {
    throw contractError(Error, 'ERR_CAPTURE_IMAGE_EMPTY', '截图源画面为空')
  }

  const rawSize = image.getSize()
  const pixelSize = normalizeSize(rawSize, 'framePixelSize')
  if (!Number.isSafeInteger(pixelSize.width) || !Number.isSafeInteger(pixelSize.height)) {
    throw contractError(RangeError, 'ERR_CAPTURE_DIMENSION', 'CaptureFrame pixel dimensions must be safe integers')
  }
  const screenDipRect = normalizePositiveRect(display && display.bounds, 'display.bounds')
  const displayRotation = normalizeRotation(display && display.rotation, 'display.rotation')
  // desktopCapturer 的缩略图通常已经按屏幕视觉方向编码，因此默认 frameRotation 为 0。
  // 若输入 PNG 仍是面板原始方向，frameRotation 表示把它顺时针旋转多少度后与屏幕 DIP 对齐。
  const rotation = normalizeRotation(options.frameRotation, 'frameRotation')
  const visualPixelSize = rotatedSize(pixelSize, rotation)
  const aspect = assertAspectCompatible(screenDipRect, visualPixelSize, {
    leftName: 'display.bounds',
    rightName: 'CaptureFrame visual pixels',
    tolerance: options.aspectTolerance,
  })
  const scaleFactor = positiveNumber(display && display.scaleFactor === undefined ? 1 : display.scaleFactor, 'display.scaleFactor')
  // PNG 只编码一次并留在闭包中；所有公开读取都返回副本，旧 image.toPNG() 也走同一份字节。
  const canonicalPng = pngBuffer(options.png === undefined
    ? (typeof image.toPNG === 'function' ? image.toPNG() : null)
    : options.png)
  const pngSha256 = crypto.createHash('sha256').update(canonicalPng).digest('hex')
  const toPNG = () => Buffer.from(canonicalPng)
  const toDataURL = () => `data:image/png;base64,${canonicalPng.toString('base64')}`
  const crop = (rect) => image.crop(normalizePixelCrop(rect, pixelSize))
  const imageView = Object.freeze({
    isEmpty: () => false,
    getSize: () => ({ width: pixelSize.width, height: pixelSize.height }),
    toPNG,
    toDataURL,
    crop,
  })
  const sourceId = source && source.id !== undefined && source.id !== null ? String(source.id) : ''

  return Object.freeze({
    kind: CAPTURE_FRAME_KIND,
    version: CAPTURE_FRAME_VERSION,
    displayId,
    sourceDisplayId,
    sourceId,
    screenDipRect,
    scaleFactor,
    displayRotation,
    rotation,
    pixelSize,
    visualPixelSize,
    aspect,
    pngByteLength: canonicalPng.length,
    pngSha256,
    image: imageView,
    toPNG,
    toDataURL,
    crop,
  })
}

function normalizeClampMode(options, fallback = CLAMP_NONE) {
  const value = options && Object.hasOwn(options, 'clamp') ? options.clamp : fallback
  if (value === true || value === CLAMP_EDGE) return CLAMP_EDGE
  if (value === false || value === CLAMP_NONE) return CLAMP_NONE
  throw contractError(RangeError, 'ERR_CAPTURE_CLAMP', `clamp must be '${CLAMP_NONE}' or '${CLAMP_EDGE}'`)
}

function normalizePixelRounding(options) {
  const value = options && options.rounding !== undefined ? options.rounding : PIXEL_ROUND_COVER
  if (value !== PIXEL_ROUND_NONE && value !== PIXEL_ROUND_COVER && value !== PIXEL_ROUND_NEAREST) {
    throw contractError(
      RangeError,
      'ERR_CAPTURE_PIXEL_ROUNDING',
      `rounding must be '${PIXEL_ROUND_NONE}', '${PIXEL_ROUND_COVER}', or '${PIXEL_ROUND_NEAREST}'`,
    )
  }
  return value
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function unitFromRect(point, rect, clampMode) {
  let u = (finiteNumber(point && point.x, 'point.x') - rect.x) / rect.width
  let v = (finiteNumber(point && point.y, 'point.y') - rect.y) / rect.height
  if (clampMode === CLAMP_EDGE) {
    u = clampNumber(u, 0, 1)
    v = clampNumber(v, 0, 1)
  }
  return { u, v }
}

function pointFromUnit(unit, rect) {
  return {
    x: rect.x + unit.u * rect.width,
    y: rect.y + unit.v * rect.height,
  }
}

function visualUnitToFrameUnit(unit, rotation) {
  if (rotation === 90) return { u: unit.v, v: 1 - unit.u }
  if (rotation === 180) return { u: 1 - unit.u, v: 1 - unit.v }
  if (rotation === 270) return { u: 1 - unit.v, v: unit.u }
  return { u: unit.u, v: unit.v }
}

function frameUnitToVisualUnit(unit, rotation) {
  if (rotation === 90) return { u: 1 - unit.v, v: unit.u }
  if (rotation === 180) return { u: 1 - unit.u, v: 1 - unit.v }
  if (rotation === 270) return { u: unit.v, v: 1 - unit.u }
  return { u: unit.u, v: unit.v }
}

function mapRectCorners(rect, mapper) {
  const edges = normalizeRectEdges(rect, 'rect')
  const points = [
    mapper({ x: edges.left, y: edges.top }),
    mapper({ x: edges.right, y: edges.top }),
    mapper({ x: edges.left, y: edges.bottom }),
    mapper({ x: edges.right, y: edges.bottom }),
  ]
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return rectFromEdges({
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  })
}

function roundFramePixelRect(rect, pixelSize, clampMode, rounding) {
  const edges = normalizeRectEdges(rect, 'framePixelRect')
  let left = edges.left
  let top = edges.top
  let right = edges.right
  let bottom = edges.bottom
  if (rounding === PIXEL_ROUND_COVER) {
    left = Math.floor(left + FLOAT_EPSILON)
    top = Math.floor(top + FLOAT_EPSILON)
    right = Math.ceil(right - FLOAT_EPSILON)
    bottom = Math.ceil(bottom - FLOAT_EPSILON)
  } else if (rounding === PIXEL_ROUND_NEAREST) {
    left = Math.round(left)
    top = Math.round(top)
    right = Math.round(right)
    bottom = Math.round(bottom)
  }
  if (clampMode === CLAMP_EDGE) {
    left = clampNumber(left, 0, pixelSize.width)
    top = clampNumber(top, 0, pixelSize.height)
    right = clampNumber(right, 0, pixelSize.width)
    bottom = clampNumber(bottom, 0, pixelSize.height)
  }
  return rectFromEdges({ left, top, right, bottom })
}

function createCoordinateTransform(options) {
  if (!options || typeof options !== 'object') {
    throw contractError(TypeError, 'ERR_CAPTURE_TRANSFORM', 'Coordinate transform options are required')
  }
  const frame = options.frame
  const screenDipRect = normalizePositiveRect(
    options.screenDipRect || (frame && frame.screenDipRect),
    'screenDipRect',
  )
  const overlayViewportRect = normalizePositiveRect(
    options.overlayViewportRect || options.overlayViewport,
    'overlayViewportRect',
  )
  const renderedImageRect = normalizePositiveRect(
    options.renderedImageRect || overlayViewportRect,
    'renderedImageRect',
  )
  const framePixelSize = normalizeSize(
    options.framePixelSize || (frame && frame.pixelSize),
    'framePixelSize',
  )
  const rotation = normalizeRotation(
    options.rotation === undefined ? (frame && frame.rotation) : options.rotation,
    'rotation',
  )
  const visualPixelSize = rotatedSize(framePixelSize, rotation)
  const screenAspect = assertAspectCompatible(screenDipRect, visualPixelSize, {
    leftName: 'screenDipRect',
    rightName: 'CaptureFrame visual pixels',
    tolerance: options.aspectTolerance,
  })
  const renderedAspect = assertAspectCompatible(renderedImageRect, visualPixelSize, {
    leftName: 'renderedImageRect',
    rightName: 'CaptureFrame visual pixels',
    tolerance: options.aspectTolerance,
  })

  // 点坐标表示像素/矩形边界（可到 width/height），不是限制在 width - 1 的采样索引。
  // 默认不钳制；裁剪调用方必须显式使用 edge clamp 和像素舍入策略。
  function screenDipToOverlayCss(point, mapOptions) {
    const clampMode = normalizeClampMode(mapOptions)
    return pointFromUnit(unitFromRect(point, screenDipRect, clampMode), overlayViewportRect)
  }

  function overlayCssToScreenDip(point, mapOptions) {
    const clampMode = normalizeClampMode(mapOptions)
    return pointFromUnit(unitFromRect(point, overlayViewportRect, clampMode), screenDipRect)
  }

  function visualPointToFramePixel(point, sourceRect, mapOptions) {
    const clampMode = normalizeClampMode(mapOptions)
    const visualUnit = unitFromRect(point, sourceRect, clampMode)
    const frameUnit = visualUnitToFrameUnit(visualUnit, rotation)
    return { x: frameUnit.u * framePixelSize.width, y: frameUnit.v * framePixelSize.height }
  }

  function framePixelToVisualPoint(point, targetRect, mapOptions) {
    const clampMode = normalizeClampMode(mapOptions)
    const frameRect = { x: 0, y: 0, width: framePixelSize.width, height: framePixelSize.height }
    const frameUnit = unitFromRect(point, frameRect, clampMode)
    return pointFromUnit(frameUnitToVisualUnit(frameUnit, rotation), targetRect)
  }

  function overlayCssToFramePixel(point, mapOptions) {
    return visualPointToFramePixel(point, renderedImageRect, mapOptions)
  }

  function framePixelToOverlayCss(point, mapOptions) {
    return framePixelToVisualPoint(point, renderedImageRect, mapOptions)
  }

  function screenDipToFramePixel(point, mapOptions) {
    return visualPointToFramePixel(point, screenDipRect, mapOptions)
  }

  function framePixelToScreenDip(point, mapOptions) {
    return framePixelToVisualPoint(point, screenDipRect, mapOptions)
  }

  function rectToFramePixels(rect, pointMapper, mapOptions) {
    const clampMode = normalizeClampMode(mapOptions)
    const rounding = normalizePixelRounding(mapOptions)
    const mapped = mapRectCorners(rect, (point) => pointMapper(point, { clamp: clampMode }))
    return roundFramePixelRect(mapped, framePixelSize, clampMode, rounding)
  }

  function overlayCssRectToFramePixels(rect, mapOptions) {
    return rectToFramePixels(rect, overlayCssToFramePixel, mapOptions)
  }

  function screenDipRectToFramePixels(rect, mapOptions) {
    return rectToFramePixels(rect, screenDipToFramePixel, mapOptions)
  }

  function framePixelsRectToOverlayCss(rect, mapOptions) {
    return mapRectCorners(rect, (point) => framePixelToOverlayCss(point, mapOptions))
  }

  function framePixelsRectToScreenDip(rect, mapOptions) {
    return mapRectCorners(rect, (point) => framePixelToScreenDip(point, mapOptions))
  }

  function screenDipRectToOverlayCss(rect, mapOptions) {
    return mapRectCorners(rect, (point) => screenDipToOverlayCss(point, mapOptions))
  }

  function overlayCssRectToScreenDip(rect, mapOptions) {
    return mapRectCorners(rect, (point) => overlayCssToScreenDip(point, mapOptions))
  }

  return Object.freeze({
    screenDipRect,
    overlayViewportRect,
    renderedImageRect,
    framePixelSize,
    visualPixelSize,
    rotation,
    aspect: Object.freeze({ screen: screenAspect, renderedImage: renderedAspect }),
    screenDipToOverlayCss,
    overlayCssToScreenDip,
    overlayCssToFramePixel,
    framePixelToOverlayCss,
    screenDipToFramePixel,
    framePixelToScreenDip,
    overlayCssRectToFramePixels,
    screenDipRectToFramePixels,
    framePixelsRectToOverlayCss,
    framePixelsRectToScreenDip,
    screenDipRectToOverlayCss,
    overlayCssRectToScreenDip,
  })
}

module.exports = {
  CAPTURE_FRAME_KIND,
  CAPTURE_FRAME_VERSION,
  CLAMP_EDGE,
  CLAMP_NONE,
  PIXEL_ROUND_COVER,
  PIXEL_ROUND_NEAREST,
  PIXEL_ROUND_NONE,
  assertAspectCompatible,
  createCaptureFrame,
  createCoordinateTransform,
  matchDisplaySource,
  normalizeRotation,
}
