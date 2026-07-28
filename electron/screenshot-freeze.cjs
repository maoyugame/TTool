const {
  CLAMP_EDGE,
  PIXEL_ROUND_COVER,
  createCaptureFrame,
  createCoordinateTransform,
  matchDisplaySource,
} = require('./screenshot-capture-core.cjs')

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positiveDimension(value, fallback) {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  const fallbackValue = Number(fallback)
  return Number.isFinite(fallbackValue) && fallbackValue > 0 ? fallbackValue : 1
}

function normalizeOverlayViewport(display, viewport) {
  const bounds = display && display.bounds ? display.bounds : {}
  return {
    width: positiveDimension(viewport && viewport.width, bounds.width),
    height: positiveDimension(viewport && viewport.height, bounds.height),
  }
}

function normalizeOverlayRect(rect, viewport) {
  const width = positiveDimension(viewport && viewport.width, 1)
  const height = positiveDimension(viewport && viewport.height, 1)
  const x1 = finiteNumber(rect && rect.x)
  const y1 = finiteNumber(rect && rect.y)
  const x2 = x1 + finiteNumber(rect && rect.width)
  const y2 = y1 + finiteNumber(rect && rect.height)
  const left = clamp(Math.min(x1, x2), 0, width)
  const top = clamp(Math.min(y1, y2), 0, height)
  const right = clamp(Math.max(x1, x2), 0, width)
  const bottom = clamp(Math.max(y1, y2), 0, height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function mapOverlayRectToSize(rect, viewport, targetSize) {
  const sourceWidth = positiveDimension(viewport && viewport.width, 1)
  const sourceHeight = positiveDimension(viewport && viewport.height, 1)
  const targetWidth = Math.max(1, Math.round(positiveDimension(targetSize && targetSize.width, 1)))
  const targetHeight = Math.max(1, Math.round(positiveDimension(targetSize && targetSize.height, 1)))
  const normalized = normalizeOverlayRect(rect, { width: sourceWidth, height: sourceHeight })
  const left = clamp(Math.round(normalized.x * targetWidth / sourceWidth), 0, targetWidth - 1)
  const top = clamp(Math.round(normalized.y * targetHeight / sourceHeight), 0, targetHeight - 1)
  const right = clamp(Math.round((normalized.x + normalized.width) * targetWidth / sourceWidth), left + 1, targetWidth)
  const bottom = clamp(Math.round((normalized.y + normalized.height) * targetHeight / sourceHeight), top + 1, targetHeight)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function resolveOverlaySelection(display, rect, viewport) {
  const resolvedViewport = normalizeOverlayViewport(display, viewport)
  const resolvedRect = normalizeOverlayRect(rect, resolvedViewport)
  const bounds = display && display.bounds ? display.bounds : {}
  const displayRect = mapOverlayRectToSize(resolvedRect, resolvedViewport, {
    width: bounds.width,
    height: bounds.height,
  })
  return { rect: resolvedRect, viewport: resolvedViewport, displayRect }
}

async function captureDisplayFrame(desktopCapturer, display) {
  const width = Math.max(1, Math.round(display.bounds.width * (display.scaleFactor || 1)))
  const height = Math.max(1, Math.round(display.bounds.height * (display.scaleFactor || 1)))
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })
  const source = matchDisplaySource(sources, display)
  if (!source.thumbnail || typeof source.thumbnail.isEmpty !== 'function' || source.thumbnail.isEmpty()) {
    const error = new Error(`显示器 ${display.id} 的截图源画面为空`)
    error.code = 'ERR_CAPTURE_IMAGE_EMPTY'
    throw error
  }
  return createCaptureFrame({ display, source })
}

async function captureFrozenDisplays(desktopCapturer, displays) {
  if (!Array.isArray(displays)) throw new TypeError('displays must be an array')
  const displayIds = displays.map((display) => String(display && display.id))
  if (new Set(displayIds).size !== displayIds.length) {
    const error = new Error('显示器列表包含重复 id')
    error.code = 'ERR_CAPTURE_DISPLAY_DUPLICATE'
    throw error
  }
  const entries = await Promise.all(displays.map(async (display) => [
    String(display.id),
    await captureDisplayFrame(desktopCapturer, display),
  ]))
  return new Map(entries)
}

function cropFrozenDisplayRegion(frame, display, rect, viewport, renderedImageRect) {
  if (!frame || !frame.image || frame.image.isEmpty()) throw new Error('截图已失效，请重试')
  if (frame.displayId !== undefined && String(frame.displayId) !== String(display && display.id)) {
    const error = new Error(`CaptureFrame ${frame.displayId} 不属于显示器 ${display && display.id}`)
    error.code = 'ERR_CAPTURE_FRAME_DISPLAY_MISMATCH'
    throw error
  }
  const size = frame.pixelSize || frame.image.getSize()
  const resolvedViewport = normalizeOverlayViewport(display, viewport)
  const transform = createCoordinateTransform({
    screenDipRect: display && display.bounds,
    overlayViewport: { x: 0, y: 0, width: resolvedViewport.width, height: resolvedViewport.height },
    renderedImageRect: renderedImageRect || { x: 0, y: 0, width: resolvedViewport.width, height: resolvedViewport.height },
    framePixelSize: size,
    rotation: frame.rotation || 0,
  })
  const crop = transform.overlayCssRectToFramePixels(rect, {
    clamp: CLAMP_EDGE,
    rounding: PIXEL_ROUND_COVER,
  })
  if (crop.width <= 0 || crop.height <= 0) {
    const error = new RangeError('截图选区未覆盖 CaptureFrame 像素')
    error.code = 'ERR_CAPTURE_CROP_EMPTY'
    throw error
  }
  const cropped = typeof frame.crop === 'function' ? frame.crop(crop) : frame.image.crop(crop)
  const croppedSize = cropped.getSize()
  return { imageDataUrl: cropped.toDataURL(), width: croppedSize.width, height: croppedSize.height }
}

module.exports = {
  captureDisplayFrame,
  captureFrozenDisplays,
  cropFrozenDisplayRegion,
  createCaptureFrame,
  createCoordinateTransform,
  mapOverlayRectToSize,
  matchDisplaySource,
  resolveOverlaySelection,
}
