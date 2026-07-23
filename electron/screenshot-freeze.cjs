function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

async function captureDisplayFrame(desktopCapturer, display) {
  const width = Math.max(1, Math.round(display.bounds.width * (display.scaleFactor || 1)))
  const height = Math.max(1, Math.round(display.bounds.height * (display.scaleFactor || 1)))
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })
  const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0]
  if (!source || source.thumbnail.isEmpty()) throw new Error('截图失败，请重试')
  return {
    image: source.thumbnail,
  }
}

async function captureFrozenDisplays(desktopCapturer, displays) {
  const entries = await Promise.all(displays.map(async (display) => [
    String(display.id),
    await captureDisplayFrame(desktopCapturer, display),
  ]))
  return new Map(entries)
}

function cropFrozenDisplayRegion(frame, display, rect) {
  if (!frame || !frame.image || frame.image.isEmpty()) throw new Error('截图已失效，请重试')
  const size = frame.image.getSize()
  const sx = size.width / display.bounds.width
  const sy = size.height / display.bounds.height
  const crop = {
    x: clamp(Math.round(rect.x * sx), 0, Math.max(0, size.width - 1)),
    y: clamp(Math.round(rect.y * sy), 0, Math.max(0, size.height - 1)),
    width: clamp(Math.round(rect.width * sx), 1, size.width),
    height: clamp(Math.round(rect.height * sy), 1, size.height),
  }
  crop.width = Math.min(crop.width, size.width - crop.x)
  crop.height = Math.min(crop.height, size.height - crop.y)
  const cropped = frame.image.crop(crop)
  const croppedSize = cropped.getSize()
  return { imageDataUrl: cropped.toDataURL(), width: croppedSize.width, height: croppedSize.height }
}

module.exports = { captureFrozenDisplays, cropFrozenDisplayRegion }
