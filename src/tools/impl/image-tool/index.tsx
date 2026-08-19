import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from 'react'
import { registerTool } from '../../registry'
import { Panel, ToolHeader, ToolPage } from '../../ui'
import { useToolbox } from '../../../store/toolbox'

type ExportFormat = 'png' | 'jpeg' | 'webp'
type Rotation = 0 | 90 | 180 | 270

interface DecodedRaster {
  drawable: CanvasImageSource
  width: number
  height: number
  dispose: () => void
}

interface SourceImage extends DecodedRaster {
  url: string
  name: string
  type: string
  size: number
  isGif: boolean
}

interface OutputSpec {
  targetWidth: number
  targetHeight: number
  width: number
  height: number
  pixels: number
  rotation: Rotation
}

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_EDGE = 16_384
const MAX_OUTPUT_PIXELS = 40_000_000

const SUPPORTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'])
const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'])

const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string; mime: string; extension: string }> = [
  { value: 'png', label: 'PNG（无损）', mime: 'image/png', extension: 'png' },
  { value: 'jpeg', label: 'JPEG', mime: 'image/jpeg', extension: 'jpg' },
  { value: 'webp', label: 'WebP', mime: 'image/webp', extension: 'webp' },
]

const IMAGE_TOOL_CSS = `
  .image-tool { min-width: 0; }
  .image-tool-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  .image-tool-button {
    appearance: none; border: 1px solid var(--fieldHair); border-radius: 9px; background: var(--pill); color: var(--text);
    padding: 8px 12px; font-size: 12.5px; font-weight: 620; line-height: 1.2; cursor: pointer; transition: border-color .16s, background .16s, transform .16s;
  }
  .image-tool-button:hover:not(:disabled) { border-color: var(--hair2); background: var(--surface3); transform: translateY(-1px); }
  .image-tool-button:focus-visible, .image-tool-dropzone:focus-visible, .image-tool-number:focus-visible, .image-tool-select:focus-visible, .image-tool-color:focus-visible, .image-tool-range:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .image-tool-button:disabled { opacity: .48; cursor: not-allowed; }
  .image-tool-button-primary { background: var(--accent); border-color: var(--accent); color: var(--canvas); }
  .image-tool-button-primary:hover:not(:disabled) { background: var(--accent); border-color: var(--accent); }
  .image-tool-button.is-active { border-color: var(--accent); background: var(--accentSoft); }
  .image-tool-workspace { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(260px, .72fr); gap: 14px; min-width: 0; }
  .image-tool-stages { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; min-width: 0; }
  .image-tool-stage { min-width: 0; }
  .image-tool-canvas-area {
    display: flex; align-items: center; justify-content: center; min-height: 300px; padding: 16px; overflow: hidden;
    background-color: var(--field);
    background-image: linear-gradient(45deg, var(--surface3) 25%, transparent 25%), linear-gradient(-45deg, var(--surface3) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--surface3) 75%), linear-gradient(-45deg, transparent 75%, var(--surface3) 75%);
    background-position: 0 0, 0 10px, 10px -10px, -10px 0; background-size: 20px 20px;
  }
  .image-tool-original, .image-tool-preview { display: block; max-width: 100%; max-height: min(46vh, 440px); object-fit: contain; border-radius: 7px; box-shadow: 0 14px 28px var(--accentSoft); }
  .image-tool-empty { display: grid; place-items: center; gap: 7px; max-width: 270px; text-align: center; color: var(--text2); font-size: 12.5px; line-height: 1.55; }
  .image-tool-empty-mark { color: var(--text3); font-size: 30px; line-height: 1; }
  .image-tool-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--hair); }
  .image-tool-meta-item { min-width: 0; padding: 10px 13px; border-right: 1px solid var(--hair); }
  .image-tool-meta-item:nth-child(2n) { border-right: 0; }
  .image-tool-meta-label { display: block; margin-bottom: 3px; color: var(--text3); font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
  .image-tool-meta-value { display: block; overflow: hidden; color: var(--text); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .image-tool-settings { min-width: 0; }
  .image-tool-controls { display: grid; gap: 15px; padding: 15px; }
  .image-tool-control-group { display: grid; gap: 9px; }
  .image-tool-control-title { color: var(--text2); font-size: 11.5px; font-weight: 700; letter-spacing: .045em; text-transform: uppercase; }
  .image-tool-dimensions { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: end; gap: 7px; }
  .image-tool-field { display: grid; gap: 5px; min-width: 0; }
  .image-tool-field label { color: var(--text3); font-size: 11px; }
  .image-tool-number, .image-tool-select {
    width: 100%; min-width: 0; border: 1px solid var(--fieldHair); border-radius: 8px; background: var(--field); color: var(--text); padding: 8px 9px; font-size: 13px;
  }
  .image-tool-dimension-sign { padding-bottom: 9px; color: var(--text3); font-size: 15px; }
  .image-tool-lock { display: inline-flex; align-items: center; gap: 7px; width: fit-content; color: var(--text2); font-size: 12px; cursor: pointer; }
  .image-tool-lock input { accent-color: var(--accent); }
  .image-tool-transform-row, .image-tool-export-row { display: flex; flex-wrap: wrap; gap: 7px; }
  .image-tool-note { color: var(--text3); font-size: 11.5px; line-height: 1.55; }
  .image-tool-range-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }
  .image-tool-range { width: 100%; accent-color: var(--accent); }
  .image-tool-quality { min-width: 39px; color: var(--text2); font-size: 12px; text-align: right; }
  .image-tool-background { display: flex; align-items: center; gap: 9px; }
  .image-tool-color { width: 36px; height: 30px; padding: 2px; border: 1px solid var(--fieldHair); border-radius: 8px; background: var(--field); cursor: pointer; }
  .image-tool-code { color: var(--text2); font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; }
  .image-tool-dropzone { appearance: none; display: grid; place-items: center; min-height: 128px; margin: 0 15px 15px; padding: 17px; border: 1px dashed var(--fieldHair); border-radius: 11px; background: var(--field); color: var(--text2); cursor: pointer; font: inherit; text-align: center; }
  .image-tool-dropzone:hover, .image-tool-dragging .image-tool-dropzone { border-color: var(--accent); background: var(--accentSoft); }
  .image-tool-dropzone strong { display: block; margin-bottom: 5px; color: var(--text); font-size: 13px; }
  .image-tool-dropzone span { display: block; color: var(--text3); font-size: 11.5px; line-height: 1.5; }
  .image-tool-alerts { display: grid; gap: 8px; margin-top: 14px; }
  .image-tool-alert { border: 1px solid var(--fieldHair); border-radius: 10px; background: var(--field); color: var(--text2); padding: 10px 12px; font-size: 12px; line-height: 1.52; }
  .image-tool-alert strong { color: var(--text); }
  .image-tool-summary { display: flex; align-items: center; justify-content: space-between; gap: 9px; padding: 10px 13px; border-top: 1px solid var(--hair); color: var(--text2); font-size: 11.5px; }
  .image-tool-summary span:last-child { color: var(--text3); white-space: nowrap; }
  @media (max-width: 1060px) { .image-tool-workspace { grid-template-columns: 1fr; } .image-tool-settings { max-width: none; } }
  @media (max-width: 700px) { .image-tool-stages { grid-template-columns: 1fr; } .image-tool-canvas-area { min-height: 230px; } .image-tool-actions { justify-content: flex-start; } }
  @media (max-width: 520px) { .image-tool-meta { grid-template-columns: 1fr; } .image-tool-meta-item { border-right: 0; border-bottom: 1px solid var(--hair); } .image-tool-meta-item:last-child { border-bottom: 0; } }
`

function extensionOf(name: string): string {
  const match = /\.([^.]+)$/.exec(name.trim())
  return match ? match[1].toLowerCase() : ''
}

function isSupportedRaster(file: File): boolean {
  const mime = file.type.toLowerCase()
  if (mime === 'image/svg+xml') return false
  return SUPPORTED_MIME_TYPES.has(mime) || SUPPORTED_EXTENSIONS.has(extensionOf(file.name))
}

function isGif(file: File): boolean {
  return file.type.toLowerCase() === 'image/gif' || extensionOf(file.name) === 'gif'
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 || value >= 10 ? 0 : 1)} ${units[exponent]}`
}

function formatMegapixels(pixels: number): string {
  const megapixels = pixels / 1_000_000
  return `${megapixels >= 10 ? megapixels.toFixed(1) : megapixels.toFixed(2)} MP`
}

function sourceTypeLabel(source: SourceImage): string {
  const mime = source.type.toLowerCase()
  const labels: Record<string, string> = {
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'image/webp': 'WebP',
    'image/gif': 'GIF',
    'image/bmp': 'BMP',
    'image/avif': 'AVIF',
  }
  return labels[mime] ?? (extensionOf(source.name).toUpperCase() || '图片')
}

function loosePositiveInteger(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const numeric = Number(normalized)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
}

function validateDimension(label: string, value: string): { value?: number; error?: string } {
  const numeric = loosePositiveInteger(value)
  if (numeric === null) return { error: `请为${label}输入正整数。` }
  if (numeric > MAX_EDGE) return { error: `${label}不能超过 ${MAX_EDGE.toLocaleString()} px。` }
  return { value: numeric }
}

function getOutputSpec(widthText: string, heightText: string, rotation: Rotation): { output?: OutputSpec; error?: string } {
  const width = validateDimension('宽度', widthText)
  if (!width.value) return { error: width.error }
  const height = validateDimension('高度', heightText)
  if (!height.value) return { error: height.error }
  const pixels = width.value * height.value
  if (pixels > MAX_OUTPUT_PIXELS) {
    return { error: `输出为 ${formatMegapixels(pixels)}，超过 ${formatMegapixels(MAX_OUTPUT_PIXELS)} 上限。请降低宽度或高度。` }
  }
  const sideways = rotation === 90 || rotation === 270
  return {
    output: {
      targetWidth: width.value,
      targetHeight: height.value,
      width: sideways ? height.value : width.value,
      height: sideways ? width.value : height.value,
      pixels,
      rotation,
    },
  }
}

function revokeObjectUrl(url: string | null | undefined): void {
  if (!url || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return
  try {
    URL.revokeObjectURL(url)
  } catch {
    // 浏览器已释放或拒绝释放时无需影响页面。
  }
}

function disposeRaster(raster: DecodedRaster | null | undefined): void {
  try {
    raster?.dispose()
  } catch {
    // 资源可能已由浏览器关闭；清理仍应继续。
  }
}

async function decodeRaster(file: File, objectUrl: string): Promise<DecodedRaster> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          drawable: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          dispose: () => {
            try {
              bitmap.close()
            } catch {
              // 关闭已关闭的 ImageBitmap 不应影响页面清理。
            }
          },
        }
      }
      bitmap.close()
    } catch {
      // 部分浏览器对某些格式不支持 ImageBitmap，回退到 <img> 解码。
    }
  }

  if (typeof Image === 'undefined') throw new Error('当前运行环境不支持浏览器图片解码。')
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.decoding = 'async'
    element.onload = () => {
      const decoded = typeof element.decode === 'function' ? element.decode() : Promise.resolve()
      decoded.then(
        () => resolve(element),
        () => {
          if (element.naturalWidth > 0 && element.naturalHeight > 0) resolve(element)
          else reject(new Error('图片解码失败。'))
        }
      )
    }
    element.onerror = () => reject(new Error('图片解码失败。'))
    element.src = objectUrl
  })

  if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片没有可用的像素尺寸。')
  return {
    drawable: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    dispose: () => {
      image.src = ''
    },
  }
}

function paintRaster(
  canvas: HTMLCanvasElement,
  source: SourceImage,
  output: OutputSpec,
  flipHorizontal: boolean,
  flipVertical: boolean,
  format: ExportFormat,
  jpegBackground: string
): void {
  canvas.width = output.width
  canvas.height = output.height
  if (canvas.width !== output.width || canvas.height !== output.height) {
    throw new Error('浏览器无法创建这个尺寸的画布。')
  }
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器不支持 2D 画布。')

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  if (format === 'jpeg') {
    context.fillStyle = jpegBackground
    context.fillRect(0, 0, output.width, output.height)
  } else {
    context.clearRect(0, 0, output.width, output.height)
  }

  context.save()
  context.translate(output.width / 2, output.height / 2)
  context.rotate((output.rotation * Math.PI) / 180)
  context.scale(flipHorizontal ? -1 : 1, flipVertical ? -1 : 1)
  context.drawImage(source.drawable, -output.targetWidth / 2, -output.targetHeight / 2, output.targetWidth, output.targetHeight)
  context.restore()
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('浏览器未能编码图片。'))
      },
      mime,
      quality
    )
  })
}

function safeFilenameBase(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, '').trim()
  const normalized = typeof withoutExtension.normalize === 'function' ? withoutExtension.normalize('NFKC') : withoutExtension
  const safe = normalized.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80)
  return safe && !/^\.+$/.test(safe) ? safe : 'image'
}

function downloadName(
  source: SourceImage,
  output: OutputSpec,
  format: ExportFormat,
  quality: number,
  flipHorizontal: boolean,
  flipVertical: boolean
): string {
  const option = FORMAT_OPTIONS.find((item) => item.value === format) ?? FORMAT_OPTIONS[0]
  const flips = `${flipHorizontal ? 'h' : ''}${flipVertical ? 'v' : ''}` || 'n'
  const qualityPart = format === 'png' ? '' : `-q${quality}`
  return `${safeFilenameBase(source.name)}-${output.width}x${output.height}-r${output.rotation}-f${flips}${qualityPart}.${option.extension}`
}

function ImageTool() {
  const { flash } = useToolbox()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const loadVersionRef = useRef(0)
  const mountedRef = useRef(true)
  const dragDepthRef = useRef(0)
  const downloadUrlsRef = useRef(new Set<string>())
  const downloadTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>())

  const [source, setSource] = useState<SourceImage | null>(null)
  const [widthText, setWidthText] = useState('')
  const [heightText, setHeightText] = useState('')
  const [aspectLocked, setAspectLocked] = useState(true)
  const [rotation, setRotation] = useState<Rotation>(0)
  const [flipHorizontal, setFlipHorizontal] = useState(false)
  const [flipVertical, setFlipVertical] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('png')
  const [quality, setQuality] = useState(92)
  const [jpegBackground, setJpegBackground] = useState('#ffffff')
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const [renderError, setRenderError] = useState('')
  const [operationError, setOperationError] = useState('')

  const outputResult = useMemo(() => getOutputSpec(widthText, heightText, rotation), [heightText, rotation, widthText])
  const output = outputResult.output
  const selectedFormat = FORMAT_OPTIONS.find((item) => item.value === format) ?? FORMAT_OPTIONS[0]
  const isLossy = format !== 'png'
  const canExport = Boolean(source && output && !renderError && !isLoading)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadVersionRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!source) return
    return () => {
      disposeRaster(source)
      revokeObjectUrl(source.url)
    }
  }, [source])

  useEffect(() => {
    return () => {
      for (const timer of downloadTimersRef.current) clearTimeout(timer)
      downloadTimersRef.current.clear()
      for (const url of downloadUrlsRef.current) revokeObjectUrl(url)
      downloadUrlsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!source || !output) {
      setRenderError((current) => (current ? '' : current))
      return
    }
    const canvas = previewCanvasRef.current
    if (!canvas) return
    try {
      paintRaster(canvas, source, output, flipHorizontal, flipVertical, format, jpegBackground)
      setRenderError((current) => (current ? '' : current))
    } catch {
      canvas.width = 1
      canvas.height = 1
      setRenderError(`无法生成 ${output.width} × ${output.height} 的预览。请降低输出尺寸后重试。`)
    }
  }, [flipHorizontal, flipVertical, format, jpegBackground, output, source])

  const loadFile = useCallback(
    async (file: File) => {
      const requestVersion = ++loadVersionRef.current
      setSourceError('')
      setOperationError('')
      setIsLoading(true)

      if (!isSupportedRaster(file)) {
        setIsLoading(false)
        setSourceError('不支持该文件类型。请选择 PNG、JPG、WebP、GIF、BMP 或 AVIF 位图。')
        return
      }
      if (file.size > MAX_FILE_BYTES) {
        setIsLoading(false)
        setSourceError(`文件为 ${formatBytes(file.size)}，超过 ${formatBytes(MAX_FILE_BYTES)} 上限。请先压缩或缩小原图。`)
        return
      }
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        setIsLoading(false)
        setSourceError('当前运行环境不支持本地图片预览。请在浏览器或桌面版中使用此工具。')
        return
      }

      const objectUrl = URL.createObjectURL(file)
      let decoded: DecodedRaster | null = null
      try {
        decoded = await decodeRaster(file, objectUrl)
        if (requestVersion !== loadVersionRef.current) {
          disposeRaster(decoded)
          revokeObjectUrl(objectUrl)
          return
        }
        if (decoded.width > MAX_EDGE || decoded.height > MAX_EDGE) {
          const sourceWidth = decoded.width
          const sourceHeight = decoded.height
          disposeRaster(decoded)
          revokeObjectUrl(objectUrl)
          setSourceError(`原图为 ${sourceWidth.toLocaleString()} × ${sourceHeight.toLocaleString()} px，单边最大支持 ${MAX_EDGE.toLocaleString()} px。请先缩小原图。`)
          return
        }

        const nextSource: SourceImage = {
          ...decoded,
          url: objectUrl,
          name: file.name || 'image',
          type: file.type,
          size: file.size,
          isGif: isGif(file),
        }
        setSource(nextSource)
        setWidthText(String(decoded.width))
        setHeightText(String(decoded.height))
        setAspectLocked(true)
        setRotation(0)
        setFlipHorizontal(false)
        setFlipVertical(false)
        setSourceError('')
        flash(`已载入 ${file.name || '图片'}`)
      } catch {
        disposeRaster(decoded)
        revokeObjectUrl(objectUrl)
        if (requestVersion === loadVersionRef.current) {
          setSourceError('无法解码该图片。请确认文件未损坏，或换用 PNG、JPG、WebP、GIF、BMP 或 AVIF。')
        }
      } finally {
        if (requestVersion === loadVersionRef.current) setIsLoading(false)
      }
    },
    [flash]
  )

  const acceptFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.item(0)
      if (!file) return
      if (files && files.length > 1) flash('已选择第一张图片；当前工具一次处理一张。')
      void loadFile(file)
    },
    [flash, loadFile]
  )

  const handleFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      acceptFiles(event.target.files)
      event.target.value = ''
    },
    [acceptFiles]
  )

  const updateDimension = useCallback(
    (axis: 'width' | 'height', value: string) => {
      if (axis === 'width') setWidthText(value)
      else setHeightText(value)

      if (!aspectLocked || !source) return
      const numeric = loosePositiveInteger(value)
      if (numeric === null) return
      const paired = Math.max(1, axis === 'width' ? Math.round((numeric * source.height) / source.width) : Math.round((numeric * source.width) / source.height))
      if (Number.isSafeInteger(paired) && paired > 0) {
        if (axis === 'width') setHeightText(String(paired))
        else setWidthText(String(paired))
      }
    },
    [aspectLocked, source]
  )

  const setLockedAspect = useCallback(
    (locked: boolean) => {
      setAspectLocked(locked)
      if (!locked || !source) return
      const currentWidth = loosePositiveInteger(widthText)
      if (currentWidth !== null) {
        const paired = Math.max(1, Math.round((currentWidth * source.height) / source.width))
        if (Number.isSafeInteger(paired) && paired > 0) setHeightText(String(paired))
      }
    },
    [source, widthText]
  )

  const resetAdjustments = useCallback(() => {
    if (!source) return
    setWidthText(String(source.width))
    setHeightText(String(source.height))
    setAspectLocked(true)
    setRotation(0)
    setFlipHorizontal(false)
    setFlipVertical(false)
    setFormat('png')
    setQuality(92)
    setJpegBackground('#ffffff')
    setSourceError('')
    setRenderError('')
    setOperationError('')
  }, [source])

  const rotate = useCallback((direction: 1 | -1) => {
    setRotation((current) => ((current + direction * 90 + 360) % 360) as Rotation)
  }, [])

  const exportImage = useCallback(async () => {
    if (!source || !output || isLoading) return
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      setOperationError('当前运行环境不支持下载。请在浏览器或桌面版中使用此功能。')
      return
    }

    setOperationError('')
    try {
      const exportCanvas = document.createElement('canvas')
      paintRaster(exportCanvas, source, output, flipHorizontal, flipVertical, format, jpegBackground)
      const blob = await canvasToBlob(exportCanvas, selectedFormat.mime, isLossy ? quality / 100 : undefined)
      if (!mountedRef.current) return
      if (blob.type.toLowerCase() !== selectedFormat.mime) {
        throw new Error(`当前浏览器不支持 ${selectedFormat.label} 编码。`)
      }
      const filename = downloadName(source, output, format, quality, flipHorizontal, flipVertical)
      const objectUrl = URL.createObjectURL(blob)
      downloadUrlsRef.current.add(objectUrl)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = filename
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()

      let releaseTimer: ReturnType<typeof setTimeout>
      releaseTimer = setTimeout(() => {
        downloadTimersRef.current.delete(releaseTimer)
        downloadUrlsRef.current.delete(objectUrl)
        revokeObjectUrl(objectUrl)
      }, 1_000)
      downloadTimersRef.current.add(releaseTimer)
      flash(`已下载 ${filename}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : '编码失败。'
      setOperationError(`${detail} 请降低尺寸，或改用 PNG / JPEG 后重试。`)
    }
  }, [flipHorizontal, flipVertical, format, isLoading, isLossy, jpegBackground, output, quality, selectedFormat, source, flash])

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDragging(true)
  }, [])

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragDepthRef.current = 0
      setIsDragging(false)
      acceptFiles(event.dataTransfer.files)
    },
    [acceptFiles]
  )

  const pageButtonStyle: CSSProperties = { whiteSpace: 'nowrap' }

  return (
    <ToolPage scroll>
      <style>{IMAGE_TOOL_CSS}</style>
      <div
        className={`image-tool${isDragging ? ' image-tool-dragging' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <ToolHeader
          glyph="▧"
          hue="pink"
          title="图片处理"
          subtitle="调整尺寸 · 旋转翻转 · 格式导出 · 全程本地处理"
          right={
            <div className="image-tool-actions">
              <button type="button" className="image-tool-button" style={pageButtonStyle} onClick={() => fileInputRef.current?.click()}>
                选择图片
              </button>
              <button type="button" className="image-tool-button" style={pageButtonStyle} onClick={resetAdjustments} disabled={!source}>
                重置
              </button>
              <button type="button" className="image-tool-button image-tool-button-primary" style={pageButtonStyle} onClick={() => void exportImage()} disabled={!canExport}>
                下载图片
              </button>
            </div>
          }
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />

        <div className="image-tool-workspace">
          <div className="image-tool-stages">
            <div className="image-tool-stage">
              <Panel label="原图" right={source ? <span className="image-tool-code">{sourceTypeLabel(source)}</span> : undefined} flex={false}>
                <div className="image-tool-canvas-area">
                  {source ? (
                    <img className="image-tool-original" src={source.url} alt={`原图：${source.name}`} />
                  ) : (
                    <div className="image-tool-empty">
                      <span className="image-tool-empty-mark">▧</span>
                      <span>选择一张图片，或将文件拖到此页面。</span>
                    </div>
                  )}
                </div>
                {source ? (
                  <div className="image-tool-meta">
                    <div className="image-tool-meta-item">
                      <span className="image-tool-meta-label">文件名</span>
                      <span className="image-tool-meta-value" title={source.name}>{source.name}</span>
                    </div>
                    <div className="image-tool-meta-item">
                      <span className="image-tool-meta-label">源尺寸</span>
                      <span className="image-tool-meta-value">{source.width.toLocaleString()} × {source.height.toLocaleString()} px</span>
                    </div>
                    <div className="image-tool-meta-item">
                      <span className="image-tool-meta-label">类型</span>
                      <span className="image-tool-meta-value">{sourceTypeLabel(source)}</span>
                    </div>
                    <div className="image-tool-meta-item">
                      <span className="image-tool-meta-label">大小</span>
                      <span className="image-tool-meta-value">{formatBytes(source.size)}</span>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="image-tool-dropzone" onClick={() => fileInputRef.current?.click()}>
                    <span>
                      <strong>{isLoading ? '正在解码图片…' : '拖放图片到这里'}</strong>
                      <span>PNG、JPG、WebP、GIF、BMP、AVIF · 最大 50 MiB</span>
                    </span>
                  </button>
                )}
              </Panel>
            </div>

            <div className="image-tool-stage">
              <Panel label="输出预览" right={output ? <span className="image-tool-code">{output.width.toLocaleString()} × {output.height.toLocaleString()}</span> : undefined} flex={false}>
                <div className="image-tool-canvas-area">
                  {source && output ? (
                    <canvas ref={previewCanvasRef} className="image-tool-preview" role="img" aria-label={`输出预览：${output.width} × ${output.height} 像素`} />
                  ) : (
                    <div className="image-tool-empty">
                      <span className="image-tool-empty-mark">↗</span>
                      <span>{source ? '填写有效的输出尺寸后即可预览。' : '载入图片后，这里会显示处理结果。'}</span>
                    </div>
                  )}
                </div>
                <div className="image-tool-summary">
                  <span>{output ? `${formatMegapixels(output.pixels)} · ${selectedFormat.label}` : '等待输出设置'}</span>
                  <span>{source && output ? '可下载' : '—'}</span>
                </div>
              </Panel>
            </div>
          </div>

          <aside className="image-tool-settings">
            <Panel label="设置" flex={false}>
              <div className="image-tool-controls">
                <div className="image-tool-control-group">
                  <span className="image-tool-control-title">尺寸</span>
                  <div className="image-tool-dimensions">
                    <div className="image-tool-field">
                      <label htmlFor="image-tool-width">宽度</label>
                      <input id="image-tool-width" className="image-tool-number" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={5} value={widthText} onChange={(event) => updateDimension('width', event.target.value)} disabled={!source} aria-describedby="image-tool-size-note" />
                    </div>
                    <span className="image-tool-dimension-sign">×</span>
                    <div className="image-tool-field">
                      <label htmlFor="image-tool-height">高度</label>
                      <input id="image-tool-height" className="image-tool-number" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={5} value={heightText} onChange={(event) => updateDimension('height', event.target.value)} disabled={!source} aria-describedby="image-tool-size-note" />
                    </div>
                  </div>
                  <label className="image-tool-lock">
                    <input type="checkbox" checked={aspectLocked} onChange={(event) => setLockedAspect(event.target.checked)} disabled={!source} />
                    锁定原始宽高比
                  </label>
                  <span id="image-tool-size-note" className="image-tool-note">每边最大 {MAX_EDGE.toLocaleString()} px，输出最大 {formatMegapixels(MAX_OUTPUT_PIXELS)}。</span>
                </div>

                <div className="image-tool-control-group">
                  <span className="image-tool-control-title">旋转与翻转</span>
                  <div className="image-tool-transform-row">
                    <button type="button" className="image-tool-button" onClick={() => rotate(-1)} disabled={!source}>↶ 左转 90°</button>
                    <button type="button" className="image-tool-button" onClick={() => rotate(1)} disabled={!source}>右转 90° ↷</button>
                    <button type="button" className={`image-tool-button${flipHorizontal ? ' is-active' : ''}`} onClick={() => setFlipHorizontal((value) => !value)} disabled={!source} aria-pressed={flipHorizontal}>水平翻转</button>
                    <button type="button" className={`image-tool-button${flipVertical ? ' is-active' : ''}`} onClick={() => setFlipVertical((value) => !value)} disabled={!source} aria-pressed={flipVertical}>垂直翻转</button>
                  </div>
                  <span className="image-tool-note">当前旋转：{rotation}°；翻转会合并到下载结果。</span>
                </div>

                <div className="image-tool-control-group">
                  <span className="image-tool-control-title">导出</span>
                  <div className="image-tool-field">
                    <label htmlFor="image-tool-format">格式</label>
                    <select id="image-tool-format" className="image-tool-select" value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)} disabled={!source}>
                      {FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                  <div className="image-tool-field">
                    <label htmlFor="image-tool-quality">有损质量</label>
                    <div className="image-tool-range-row">
                      <input id="image-tool-quality" className="image-tool-range" type="range" min="1" max="100" step="1" value={quality} onChange={(event) => setQuality(Number(event.target.value))} disabled={!source || !isLossy} />
                      <span className="image-tool-quality">{isLossy ? `${quality}%` : '无损'}</span>
                    </div>
                  </div>
                  <div className="image-tool-field">
                    <label htmlFor="image-tool-background">JPEG 背景</label>
                    <div className="image-tool-background">
                      <input id="image-tool-background" className="image-tool-color" type="color" value={jpegBackground} onChange={(event) => setJpegBackground(event.target.value)} disabled={!source || format !== 'jpeg'} />
                      <span className="image-tool-code">{jpegBackground.toUpperCase()}</span>
                    </div>
                    <span className="image-tool-note">JPEG 不支持透明像素；导出时会用此不透明背景填充。</span>
                  </div>
                </div>
              </div>
              {source?.isGif ? <div className="image-tool-alert"><strong>GIF 提示：</strong>动画 GIF 会按首帧作为静态图片处理，动画不会保留。</div> : null}
            </Panel>
          </aside>
        </div>

        <div className="image-tool-alerts" aria-live="polite">
          {sourceError ? <div className="image-tool-alert" role="alert"><strong>无法载入：</strong>{sourceError}</div> : null}
          {source && outputResult.error ? <div className="image-tool-alert" role="alert"><strong>需要调整尺寸：</strong>{outputResult.error}</div> : null}
          {renderError ? <div className="image-tool-alert" role="alert"><strong>预览不可用：</strong>{renderError}</div> : null}
          {operationError ? <div className="image-tool-alert" role="alert"><strong>导出失败：</strong>{operationError}</div> : null}
        </div>
      </div>
    </ToolPage>
  )
}

registerTool({
  id: 'image-tool',
  name: '图片处理',
  desc: '调整尺寸 · 旋转翻转 · 格式导出',
  glyph: '▧',
  cat: '设计',
  hue: 'pink',
  order: 80,
  component: ImageTool,
  keywords: 'image picture photo resize rotate flip convert compressor png jpg jpeg webp gif bmp avif tupian chuli tupianchuli tuxiang chuli tuxiangchuli',
})
