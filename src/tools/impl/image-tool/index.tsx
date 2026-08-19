import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from 'react'
import { registerTool } from '../../registry'
import { Panel, ToolHeader, ToolPage } from '../../ui'
import { useToolbox } from '../../../store/toolbox'

type ExportFormat = 'png' | 'jpeg' | 'webp'
type ExportChoice = 'source' | ExportFormat
type Rotation = 0 | 90 | 180 | 270
type SizeMode = 'original' | 'percentage' | 'max-edge' | 'exact'
type QueueStatus = 'validating' | 'ready' | 'processing' | 'success' | 'error'

interface DecodedRaster {
  drawable: CanvasImageSource
  width: number
  height: number
  dispose: () => void
}

interface OutputSpec {
  targetWidth: number
  targetHeight: number
  width: number
  height: number
  pixels: number
  rotation: Rotation
}

interface BatchSettings {
  sizeMode: SizeMode
  percentageText: string
  maxEdgeText: string
  exactWidthText: string
  exactHeightText: string
  rotation: Rotation
  flipHorizontal: boolean
  flipVertical: boolean
  exportChoice: ExportChoice
  quality: number
  jpegBackground: string
}

interface BatchResult {
  blob: Blob
  filename: string
  format: ExportFormat
  mime: string
  width: number
  height: number
  size: number
}

interface QueueItem {
  id: string
  file: File
  name: string
  mime: string
  typeLabel: string
  size: number
  isGif: boolean
  width?: number
  height?: number
  status: QueueStatus
  validationError?: string
  error?: string
  result?: BatchResult
}

interface ProgressState {
  completed: number
  total: number
  currentName: string
}

interface ZipEntry {
  name: string
  blob: Blob
}

const MAX_FILES = 20
const MAX_BATCH_BYTES = 200 * 1024 * 1024
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_EDGE = 16_384
const MAX_OUTPUT_PIXELS = 40_000_000
const MAX_PERCENTAGE = 1_000
const MAX_ZIP_VALUE = 0xffff_ffff
const PREVIEW_MAX_EDGE = 1_600
const PREVIEW_MAX_PIXELS = 1_500_000

const SUPPORTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'])
const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'])

const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string; shortLabel: string; mime: string; extension: string }> = [
  { value: 'png', label: 'PNG（无损重编码）', shortLabel: 'PNG', mime: 'image/png', extension: 'png' },
  { value: 'jpeg', label: 'JPEG', shortLabel: 'JPEG', mime: 'image/jpeg', extension: 'jpg' },
  { value: 'webp', label: 'WebP', shortLabel: 'WebP', mime: 'image/webp', extension: 'webp' },
]

const STATUS_LABELS: Record<QueueStatus, string> = {
  validating: '检查中',
  ready: '就绪',
  processing: '处理中',
  success: '成功',
  error: '错误',
}

const IMAGE_TOOL_CSS = `
  .image-tool { min-width: 0; }
  .image-tool-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  .image-tool-button {
    appearance: none; border: 1px solid var(--fieldHair); border-radius: 9px; background: var(--pill); color: var(--text);
    padding: 8px 12px; font-size: 12.5px; font-weight: 620; line-height: 1.2; cursor: pointer; transition: border-color .16s, background .16s, transform .16s;
  }
  .image-tool-button:hover:not(:disabled) { border-color: var(--hair2); background: var(--surface3); transform: translateY(-1px); }
  .image-tool-button:focus-visible, .image-tool-dropzone:focus-visible, .image-tool-number:focus-visible, .image-tool-select:focus-visible, .image-tool-color:focus-visible, .image-tool-range:focus-visible, .image-tool-queue-select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .image-tool-button:disabled { opacity: .48; cursor: not-allowed; }
  .image-tool-button-primary { background: var(--accent); border-color: var(--accent); color: var(--canvas); }
  .image-tool-button-primary:hover:not(:disabled) { background: var(--accent); border-color: var(--accent); }
  .image-tool-button.is-active { border-color: var(--accent); background: var(--accentSoft); }
  .image-tool-layout { display: grid; grid-template-columns: minmax(270px, .78fr) minmax(0, 1.35fr) minmax(270px, .72fr); gap: 14px; align-items: start; min-width: 0; }
  .image-tool-column { min-width: 0; }
  .image-tool-dropzone { appearance: none; display: grid; place-items: center; width: calc(100% - 30px); min-height: 104px; margin: 15px; padding: 15px; border: 1px dashed var(--fieldHair); border-radius: 11px; background: var(--field); color: var(--text2); cursor: pointer; font: inherit; text-align: center; }
  .image-tool-dropzone:hover, .image-tool-dragging .image-tool-dropzone { border-color: var(--accent); background: var(--accentSoft); }
  .image-tool-dropzone strong { display: block; margin-bottom: 5px; color: var(--text); font-size: 13px; }
  .image-tool-dropzone span { display: block; color: var(--text3); font-size: 11.5px; line-height: 1.5; }
  .image-tool-queue-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 15px 12px; color: var(--text3); font-size: 11.5px; }
  .image-tool-queue { display: grid; gap: 7px; max-height: 510px; margin: 0; padding: 0 10px 12px; overflow: auto; list-style: none; }
  .image-tool-queue-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; padding: 8px; border: 1px solid var(--hair); border-radius: 10px; background: var(--field); }
  .image-tool-queue-item.is-selected { border-color: var(--accent); background: var(--accentSoft); }
  .image-tool-queue-select { appearance: none; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; }
  .image-tool-queue-top { display: flex; align-items: center; justify-content: space-between; gap: 7px; }
  .image-tool-queue-name { min-width: 0; overflow: hidden; color: var(--text); font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .image-tool-status { flex: none; border: 1px solid var(--fieldHair); border-radius: 999px; padding: 2px 6px; color: var(--text2); font-size: 10px; font-weight: 700; }
  .image-tool-status-success { border-color: var(--accent); color: var(--accent); }
  .image-tool-status-error { color: var(--text); }
  .image-tool-queue-meta, .image-tool-queue-result, .image-tool-queue-error { display: block; margin-top: 4px; color: var(--text3); font-size: 10.8px; line-height: 1.42; }
  .image-tool-queue-result { color: var(--text2); }
  .image-tool-queue-error { color: var(--text); }
  .image-tool-queue-side { display: flex; flex-direction: column; gap: 5px; }
  .image-tool-icon-button { min-width: 30px; padding: 6px; }
  .image-tool-progress { display: grid; gap: 6px; padding: 11px 15px; border-top: 1px solid var(--hair); color: var(--text2); font-size: 11.5px; }
  .image-tool-progress-line { display: flex; justify-content: space-between; gap: 8px; }
  .image-tool-progress progress { width: 100%; height: 7px; accent-color: var(--accent); }
  .image-tool-stages { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; min-width: 0; }
  .image-tool-stage { min-width: 0; }
  .image-tool-canvas-area {
    display: flex; align-items: center; justify-content: center; min-height: 280px; padding: 14px; overflow: hidden;
    background-color: var(--field);
    background-image: linear-gradient(45deg, var(--surface3) 25%, transparent 25%), linear-gradient(-45deg, var(--surface3) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--surface3) 75%), linear-gradient(-45deg, transparent 75%, var(--surface3) 75%);
    background-position: 0 0, 0 10px, 10px -10px, -10px 0; background-size: 20px 20px;
  }
  .image-tool-original, .image-tool-preview { display: block; max-width: 100%; max-height: min(43vh, 410px); object-fit: contain; border-radius: 7px; box-shadow: 0 14px 28px var(--accentSoft); }
  .image-tool-empty { display: grid; place-items: center; gap: 7px; max-width: 270px; text-align: center; color: var(--text2); font-size: 12.5px; line-height: 1.55; }
  .image-tool-empty-mark { color: var(--text3); font-size: 30px; line-height: 1; }
  .image-tool-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--hair); }
  .image-tool-meta-item { min-width: 0; padding: 10px 13px; border-right: 1px solid var(--hair); }
  .image-tool-meta-item:nth-child(2n) { border-right: 0; }
  .image-tool-meta-label { display: block; margin-bottom: 3px; color: var(--text3); font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
  .image-tool-meta-value { display: block; overflow: hidden; color: var(--text); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .image-tool-summary { display: flex; align-items: center; justify-content: space-between; gap: 9px; padding: 10px 13px; border-top: 1px solid var(--hair); color: var(--text2); font-size: 11.5px; }
  .image-tool-summary span:last-child { color: var(--text3); white-space: nowrap; }
  .image-tool-settings { min-width: 0; }
  .image-tool-controls { display: grid; gap: 15px; padding: 15px; }
  .image-tool-control-group { display: grid; gap: 9px; }
  .image-tool-control-title { color: var(--text2); font-size: 11.5px; font-weight: 700; letter-spacing: .045em; text-transform: uppercase; }
  .image-tool-dimensions { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: end; gap: 7px; }
  .image-tool-field { display: grid; gap: 5px; min-width: 0; }
  .image-tool-field label { color: var(--text3); font-size: 11px; }
  .image-tool-number, .image-tool-select { width: 100%; min-width: 0; border: 1px solid var(--fieldHair); border-radius: 8px; background: var(--field); color: var(--text); padding: 8px 9px; font-size: 13px; }
  .image-tool-dimension-sign { padding-bottom: 9px; color: var(--text3); font-size: 15px; }
  .image-tool-lock { display: inline-flex; align-items: center; gap: 7px; width: fit-content; color: var(--text2); font-size: 12px; cursor: pointer; }
  .image-tool-lock input { accent-color: var(--accent); }
  .image-tool-transform-row { display: flex; flex-wrap: wrap; gap: 7px; }
  .image-tool-note { color: var(--text3); font-size: 11.5px; line-height: 1.55; }
  .image-tool-range-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }
  .image-tool-range { width: 100%; accent-color: var(--accent); }
  .image-tool-quality { min-width: 39px; color: var(--text2); font-size: 12px; text-align: right; }
  .image-tool-background { display: flex; align-items: center; gap: 9px; }
  .image-tool-color { width: 36px; height: 30px; padding: 2px; border: 1px solid var(--fieldHair); border-radius: 8px; background: var(--field); cursor: pointer; }
  .image-tool-code { color: var(--text2); font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; }
  .image-tool-alerts { display: grid; gap: 8px; margin-top: 14px; }
  .image-tool-alert { border: 1px solid var(--fieldHair); border-radius: 10px; background: var(--field); color: var(--text2); padding: 10px 12px; font-size: 12px; line-height: 1.52; }
  .image-tool-alert strong { color: var(--text); }
  .image-tool-results { display: grid; gap: 8px; margin-top: 14px; }
  @media (max-width: 1240px) { .image-tool-layout { grid-template-columns: minmax(260px, .72fr) minmax(0, 1.28fr); } .image-tool-settings { grid-column: 1 / -1; } }
  @media (max-width: 860px) { .image-tool-layout { grid-template-columns: 1fr; } .image-tool-settings { grid-column: auto; } .image-tool-queue { max-height: 360px; } }
  @media (max-width: 700px) { .image-tool-stages { grid-template-columns: 1fr; } .image-tool-canvas-area { min-height: 220px; } .image-tool-actions { justify-content: flex-start; } }
  @media (max-width: 560px) { .image-tool-meta { grid-template-columns: 1fr; } .image-tool-meta-item { border-right: 0; border-bottom: 1px solid var(--hair); } .image-tool-meta-item:last-child { border-bottom: 0; } }
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

function sourceTypeLabel(name: string, mime: string): string {
  const labels: Record<string, string> = {
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'image/webp': 'WebP',
    'image/gif': 'GIF',
    'image/bmp': 'BMP',
    'image/avif': 'AVIF',
  }
  return labels[mime.toLowerCase()] ?? (extensionOf(name).toUpperCase() || '未知')
}

function sourceExportFormat(item: QueueItem): ExportFormat | null {
  const mime = item.mime.toLowerCase()
  const extension = extensionOf(item.name)
  if (mime === 'image/png' || extension === 'png') return 'png'
  if (mime === 'image/jpeg' || extension === 'jpg' || extension === 'jpeg') return 'jpeg'
  if (mime === 'image/webp' || extension === 'webp') return 'webp'
  return null
}

function resolveExportFormat(item: QueueItem, choice: ExportChoice): ExportFormat | null {
  return choice === 'source' ? sourceExportFormat(item) : choice
}

function formatOption(format: ExportFormat) {
  return FORMAT_OPTIONS.find((option) => option.value === format) ?? FORMAT_OPTIONS[0]
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

function formatSavings(sourceBytes: number, outputBytes: number): string {
  if (sourceBytes <= 0) return '无法计算节省比例'
  const percent = ((sourceBytes - outputBytes) / sourceBytes) * 100
  if (Math.abs(percent) < 0.05) return '体积持平'
  return percent > 0 ? `节省 ${percent.toFixed(1)}%` : `增大 ${Math.abs(percent).toFixed(1)}%`
}

function loosePositiveInteger(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const numeric = Number(normalized)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
}

function validateBoundedInteger(label: string, value: string, maximum: number): { value?: number; error?: string } {
  const numeric = loosePositiveInteger(value)
  if (numeric === null) return { error: `请为${label}输入正整数。` }
  if (numeric > maximum) return { error: `${label}不能超过 ${maximum.toLocaleString()}。` }
  return { value: numeric }
}

function settingsError(settings: BatchSettings): string {
  if (settings.sizeMode === 'percentage') {
    return validateBoundedInteger('缩放百分比', settings.percentageText, MAX_PERCENTAGE).error ?? ''
  }
  if (settings.sizeMode === 'max-edge') {
    return validateBoundedInteger('最长边', settings.maxEdgeText, MAX_EDGE).error ?? ''
  }
  if (settings.sizeMode === 'exact') {
    const width = validateBoundedInteger('宽度', settings.exactWidthText, MAX_EDGE)
    if (!width.value) return width.error ?? '宽度无效。'
    const height = validateBoundedInteger('高度', settings.exactHeightText, MAX_EDGE)
    if (!height.value) return height.error ?? '高度无效。'
    const pixels = width.value * height.value
    if (pixels > MAX_OUTPUT_PIXELS) return `固定尺寸为 ${formatMegapixels(pixels)}，超过 ${formatMegapixels(MAX_OUTPUT_PIXELS)} 上限。`
  }
  return ''
}

function getOutputSpec(sourceWidth: number, sourceHeight: number, settings: BatchSettings): { output?: OutputSpec; error?: string } {
  const inputError = settingsError(settings)
  if (inputError) return { error: inputError }

  let targetWidth = sourceWidth
  let targetHeight = sourceHeight
  if (settings.sizeMode === 'percentage') {
    const percentage = loosePositiveInteger(settings.percentageText) ?? 100
    targetWidth = Math.max(1, Math.round((sourceWidth * percentage) / 100))
    targetHeight = Math.max(1, Math.round((sourceHeight * percentage) / 100))
  } else if (settings.sizeMode === 'max-edge') {
    const maxEdge = loosePositiveInteger(settings.maxEdgeText) ?? MAX_EDGE
    const ratio = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))
    targetWidth = Math.max(1, Math.round(sourceWidth * ratio))
    targetHeight = Math.max(1, Math.round(sourceHeight * ratio))
  } else if (settings.sizeMode === 'exact') {
    targetWidth = loosePositiveInteger(settings.exactWidthText) ?? sourceWidth
    targetHeight = loosePositiveInteger(settings.exactHeightText) ?? sourceHeight
  }

  if (targetWidth > MAX_EDGE || targetHeight > MAX_EDGE) {
    return { error: `输出 ${targetWidth.toLocaleString()} × ${targetHeight.toLocaleString()} px 超过单边 ${MAX_EDGE.toLocaleString()} px 上限。` }
  }
  const pixels = targetWidth * targetHeight
  if (pixels > MAX_OUTPUT_PIXELS) {
    return { error: `输出为 ${formatMegapixels(pixels)}，超过 ${formatMegapixels(MAX_OUTPUT_PIXELS)} 上限。` }
  }
  const sideways = settings.rotation === 90 || settings.rotation === 270
  return {
    output: {
      targetWidth,
      targetHeight,
      width: sideways ? targetHeight : targetWidth,
      height: sideways ? targetWidth : targetHeight,
      pixels,
      rotation: settings.rotation,
    },
  }
}

function boundedError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback
  const normalized = message.replace(/\s+/g, ' ').trim()
  return (normalized || fallback).slice(0, 180)
}

function revokeObjectUrl(url: string | null | undefined): void {
  if (!url || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return
  try {
    URL.revokeObjectURL(url)
  } catch {
    // URL 可能已释放；清理流程继续。
  }
}

function disposeRaster(raster: DecodedRaster | null | undefined): void {
  try {
    raster?.dispose()
  } catch {
    // ImageBitmap / HTMLImageElement 可能已释放；清理流程继续。
  }
}

function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return
  canvas.width = 1
  canvas.height = 1
}

async function decodeRaster(file: File, activeObjectUrls?: Set<string>): Promise<DecodedRaster> {
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
              // 重复关闭不影响后续资源清理。
            }
          },
        }
      }
      bitmap.close()
    } catch {
      // 某些浏览器或格式不支持 ImageBitmap，继续使用 <img> 解码。
    }
  }

  if (
    typeof Image === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    throw new Error('当前运行环境不支持浏览器图片解码。')
  }

  const objectUrl = URL.createObjectURL(file)
  activeObjectUrls?.add(objectUrl)
  try {
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
  } finally {
    activeObjectUrls?.delete(objectUrl)
    revokeObjectUrl(objectUrl)
  }
}

function paintRaster(
  canvas: HTMLCanvasElement,
  raster: DecodedRaster,
  output: OutputSpec,
  flipHorizontal: boolean,
  flipVertical: boolean,
  format: ExportFormat,
  jpegBackground: string
): void {
  canvas.width = output.width
  canvas.height = output.height
  if (canvas.width !== output.width || canvas.height !== output.height) throw new Error('浏览器无法创建这个尺寸的画布。')
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
  context.drawImage(raster.drawable, -output.targetWidth / 2, -output.targetHeight / 2, output.targetWidth, output.targetHeight)
  context.restore()
}

function previewScale(width: number, height: number): number {
  return Math.min(1, PREVIEW_MAX_EDGE / width, PREVIEW_MAX_EDGE / height, Math.sqrt(PREVIEW_MAX_PIXELS / (width * height)))
}

function paintOriginalPreview(canvas: HTMLCanvasElement, raster: DecodedRaster): void {
  const scale = previewScale(raster.width, raster.height)
  const width = Math.max(1, Math.round(raster.width * scale))
  const height = Math.max(1, Math.round(raster.height * scale))
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器不支持 2D 画布。')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.clearRect(0, 0, width, height)
  context.drawImage(raster.drawable, 0, 0, width, height)
}

function previewOutputSpec(output: OutputSpec): OutputSpec {
  const scale = previewScale(output.width, output.height)
  const targetWidth = Math.max(1, Math.round(output.targetWidth * scale))
  const targetHeight = Math.max(1, Math.round(output.targetHeight * scale))
  const sideways = output.rotation === 90 || output.rotation === 270
  return {
    targetWidth,
    targetHeight,
    width: sideways ? targetHeight : targetWidth,
    height: sideways ? targetWidth : targetHeight,
    pixels: targetWidth * targetHeight,
    rotation: output.rotation,
  }
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

function downloadName(item: QueueItem, output: OutputSpec, format: ExportFormat, settings: BatchSettings): string {
  const option = formatOption(format)
  const flips = `${settings.flipHorizontal ? 'h' : ''}${settings.flipVertical ? 'v' : ''}` || 'n'
  const qualityPart = format === 'png' ? '' : `-q${settings.quality}`
  return `${safeFilenameBase(item.name)}-${output.width}x${output.height}-r${output.rotation}-f${flips}${qualityPart}.${option.extension}`
}

function uniqueZipName(filename: string, usedNames: Set<string>): string {
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const extension = dot > 0 ? filename.slice(dot) : ''
  let candidate = filename
  let suffix = 2
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base} (${suffix})${extension}`
    suffix += 1
  }
  usedNames.add(candidate.toLowerCase())
  return candidate
}

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
}

const CRC_TABLE = makeCrcTable()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffff_ffff) >>> 0
}

function zipDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()))
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

function localZipHeader(name: Uint8Array, crc: number, size: number, time: number, date: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(30 + name.length)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x0403_4b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 0x0800, true)
  view.setUint16(8, 0, true)
  view.setUint16(10, time, true)
  view.setUint16(12, date, true)
  view.setUint32(14, crc, true)
  view.setUint32(18, size, true)
  view.setUint32(22, size, true)
  view.setUint16(26, name.length, true)
  view.setUint16(28, 0, true)
  header.set(name, 30)
  return header
}

function centralZipHeader(name: Uint8Array, crc: number, size: number, offset: number, time: number, date: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(46 + name.length)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x0201_4b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 20, true)
  view.setUint16(8, 0x0800, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, time, true)
  view.setUint16(14, date, true)
  view.setUint32(16, crc, true)
  view.setUint32(20, size, true)
  view.setUint32(24, size, true)
  view.setUint16(28, name.length, true)
  view.setUint16(30, 0, true)
  view.setUint16(32, 0, true)
  view.setUint16(34, 0, true)
  view.setUint16(36, 0, true)
  view.setUint32(38, 0, true)
  view.setUint32(42, offset, true)
  header.set(name, 46)
  return header
}

async function createStoreZip(entries: ZipEntry[], isCurrent: () => boolean): Promise<Blob | null> {
  if (typeof TextEncoder === 'undefined') throw new Error('当前环境不支持 UTF-8 ZIP 文件名。')
  if (entries.length === 0) throw new Error('没有可加入 ZIP 的成功结果。')
  const encoder = new TextEncoder()
  const localParts: BlobPart[] = []
  const centralParts: BlobPart[] = []
  const usedNames = new Set<string>()
  let localOffset = 0
  let centralSize = 0
  const stamp = zipDateTime(new Date())

  for (const entry of entries) {
    if (!isCurrent()) return null
    if (!Number.isSafeInteger(entry.blob.size) || entry.blob.size > MAX_ZIP_VALUE) throw new Error('单个结果过大，无法写入标准 ZIP。')
    const name = uniqueZipName(entry.name, usedNames)
    const nameBytes = encoder.encode(name)
    if (nameBytes.length > 0xffff) throw new Error('结果文件名过长，无法写入 ZIP。')
    const data = new Uint8Array(await entry.blob.arrayBuffer())
    if (!isCurrent()) return null
    const crc = crc32(data)
    const local = localZipHeader(nameBytes, crc, entry.blob.size, stamp.time, stamp.date)
    const central = centralZipHeader(nameBytes, crc, entry.blob.size, localOffset, stamp.time, stamp.date)
    localParts.push(local, entry.blob)
    centralParts.push(central)
    localOffset += local.length + entry.blob.size
    centralSize += central.length
    if (localOffset > MAX_ZIP_VALUE || centralSize > MAX_ZIP_VALUE) throw new Error('结果总量过大，无法写入标准 ZIP。请逐项下载。')
  }

  if (localOffset + centralSize + 22 > MAX_ZIP_VALUE) throw new Error('ZIP 归档超过 4 GiB 上限，请逐项下载。')
  const end = new Uint8Array(22)
  const view = new DataView(end.buffer)
  view.setUint32(0, 0x0605_4b50, true)
  view.setUint16(4, 0, true)
  view.setUint16(6, 0, true)
  view.setUint16(8, entries.length, true)
  view.setUint16(10, entries.length, true)
  view.setUint32(12, centralSize, true)
  view.setUint32(16, localOffset, true)
  view.setUint16(20, 0, true)
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' })
}

function isSourceValid(item: QueueItem): item is QueueItem & { width: number; height: number } {
  return Boolean(item.width && item.height && !item.validationError)
}

function ImageTool() {
  const { flash } = useToolbox()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const mountedRef = useRef(true)
  const dragDepthRef = useRef(0)
  const itemSequenceRef = useRef(0)
  const itemsRef = useRef<QueueItem[]>([])
  const selectedIdRef = useRef<string | null>(null)
  const importEpochRef = useRef(0)
  const runEpochRef = useRef(0)
  const archiveEpochRef = useRef(0)
  const previewEpochRef = useRef(0)
  const previewDecodeChainRef = useRef<Promise<void>>(Promise.resolve())
  const previewRasterRef = useRef<DecodedRaster | null>(null)
  const previewRasterOwnerRef = useRef(0)
  const processingRasterRef = useRef<DecodedRaster | null>(null)
  const processingCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const importingRef = useRef(false)
  const processingRef = useRef(false)
  const archivingRef = useRef(false)
  const workPendingRef = useRef(false)
  const archivePendingRef = useRef(false)
  const previewSourceObjectUrlsRef = useRef(new Set<string>())
  const workSourceObjectUrlsRef = useRef(new Set<string>())
  const downloadUrlsRef = useRef(new Set<string>())
  const downloadTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>())

  const [items, setItems] = useState<QueueItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewRaster, setPreviewRaster] = useState<DecodedRaster | null>(null)
  const [previewReload, setPreviewReload] = useState(0)
  const [sizeMode, setSizeMode] = useState<SizeMode>('original')
  const [percentageText, setPercentageText] = useState('80')
  const [maxEdgeText, setMaxEdgeText] = useState('1920')
  const [exactWidthText, setExactWidthText] = useState('1920')
  const [exactHeightText, setExactHeightText] = useState('1080')
  const [aspectLocked, setAspectLocked] = useState(true)
  const [rotation, setRotation] = useState<Rotation>(0)
  const [flipHorizontal, setFlipHorizontal] = useState(false)
  const [flipVertical, setFlipVertical] = useState(false)
  const [exportChoice, setExportChoice] = useState<ExportChoice>('source')
  const [quality, setQuality] = useState(92)
  const [jpegBackground, setJpegBackground] = useState('#ffffff')
  const [isDragging, setIsDragging] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [progress, setProgress] = useState<ProgressState>({ completed: 0, total: 0, currentName: '' })
  const [previewError, setPreviewError] = useState('')
  const [operationError, setOperationError] = useState('')

  const settings = useMemo<BatchSettings>(
    () => ({
      sizeMode,
      percentageText,
      maxEdgeText,
      exactWidthText,
      exactHeightText,
      rotation,
      flipHorizontal,
      flipVertical,
      exportChoice,
      quality,
      jpegBackground,
    }),
    [exactHeightText, exactWidthText, exportChoice, flipHorizontal, flipVertical, jpegBackground, maxEdgeText, percentageText, quality, rotation, sizeMode]
  )

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId])
  const selectedOutputResult = useMemo(
    () => (selectedItem && isSourceValid(selectedItem) ? getOutputSpec(selectedItem.width, selectedItem.height, settings) : {}),
    [selectedItem, settings]
  )
  const selectedOutput = selectedOutputResult.output
  const selectedFormat = selectedItem ? resolveExportFormat(selectedItem, exportChoice) : null
  const currentSettingsError = settingsError(settings)
  const sourceBytes = useMemo(() => items.reduce((total, item) => total + item.size, 0), [items])
  const successfulItems = useMemo(() => items.filter((item) => item.status === 'success' && item.result), [items])
  const aggregate = useMemo(() => {
    let inputBytes = 0
    let outputBytes = 0
    for (const item of successfulItems) {
      inputBytes += item.size
      outputBytes += item.result?.size ?? 0
    }
    return { inputBytes, outputBytes }
  }, [successfulItems])
  const hasValidItems = items.some(isSourceValid)
  const hasCompletedResults = successfulItems.length > 0
  const busy = isImporting || isProcessing || isArchiving
  const canProcess = hasValidItems && !busy && !currentSettingsError

  const commitItems = useCallback((next: QueueItem[]) => {
    itemsRef.current = next
    if (mountedRef.current) setItems(next)
  }, [])

  const updateItem = useCallback(
    (id: string, updater: (item: QueueItem) => QueueItem) => {
      const next = itemsRef.current.map((item) => (item.id === id ? updater(item) : item))
      commitItems(next)
    },
    [commitItems]
  )

  const chooseItem = useCallback((id: string | null) => {
    selectedIdRef.current = id
    if (mountedRef.current) setSelectedId(id)
  }, [])

  const revokeTransientDownloads = useCallback(() => {
    for (const timer of downloadTimersRef.current) clearTimeout(timer)
    downloadTimersRef.current.clear()
    for (const url of downloadUrlsRef.current) revokeObjectUrl(url)
    downloadUrlsRef.current.clear()
  }, [])

  const revokePreviewSourceObjectUrls = useCallback(() => {
    for (const url of previewSourceObjectUrlsRef.current) revokeObjectUrl(url)
    previewSourceObjectUrlsRef.current.clear()
  }, [])

  const revokeWorkSourceObjectUrls = useCallback(() => {
    for (const url of workSourceObjectUrlsRef.current) revokeObjectUrl(url)
    workSourceObjectUrlsRef.current.clear()
  }, [])

  const disposePreviewRaster = useCallback(() => {
    const raster = previewRasterRef.current
    previewRasterRef.current = null
    previewRasterOwnerRef.current = 0
    disposeRaster(raster)
  }, [])

  const releaseProcessingResources = useCallback(() => {
    const raster = processingRasterRef.current
    processingRasterRef.current = null
    disposeRaster(raster)
    const canvas = processingCanvasRef.current
    processingCanvasRef.current = null
    releaseCanvas(canvas)
  }, [])

  const cancelMutableWork = useCallback(() => {
    importEpochRef.current += 1
    runEpochRef.current += 1
    archiveEpochRef.current += 1
    previewEpochRef.current += 1
    importingRef.current = false
    processingRef.current = false
    archivingRef.current = false
    releaseProcessingResources()
    disposePreviewRaster()
    releaseCanvas(originalCanvasRef.current)
    releaseCanvas(previewCanvasRef.current)
    revokePreviewSourceObjectUrls()
    revokeWorkSourceObjectUrls()
    revokeTransientDownloads()
  }, [disposePreviewRaster, releaseProcessingResources, revokePreviewSourceObjectUrls, revokeTransientDownloads, revokeWorkSourceObjectUrls])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelMutableWork()
    }
  }, [cancelMutableWork])

  useEffect(() => {
    if (isProcessing) return
    const epoch = ++previewEpochRef.current
    disposePreviewRaster()
    releaseCanvas(originalCanvasRef.current)
    releaseCanvas(previewCanvasRef.current)
    revokePreviewSourceObjectUrls()
    setPreviewRaster(null)
    setPreviewError('')
    if (!selectedItem || !isSourceValid(selectedItem)) return

    const file = selectedItem.file
    const task = previewDecodeChainRef.current.then(async () => {
      if (!mountedRef.current || epoch !== previewEpochRef.current) return
      let raster: DecodedRaster | null = null
      try {
        raster = await decodeRaster(file, previewSourceObjectUrlsRef.current)
        if (!mountedRef.current || epoch !== previewEpochRef.current) {
          disposeRaster(raster)
          return
        }
        previewRasterRef.current = raster
        previewRasterOwnerRef.current = epoch
        setPreviewRaster(raster)
      } catch (error) {
        disposeRaster(raster)
        if (mountedRef.current && epoch === previewEpochRef.current) {
          setPreviewError(boundedError(error, '无法生成所选图片预览。'))
        }
      }
    })
    previewDecodeChainRef.current = task.catch(() => undefined)

    return () => {
      if (previewEpochRef.current === epoch) previewEpochRef.current += 1
      if (previewRasterOwnerRef.current === epoch) disposePreviewRaster()
    }
  }, [disposePreviewRaster, isProcessing, previewReload, revokePreviewSourceObjectUrls, selectedItem])

  useEffect(() => {
    if (!previewRaster) return
    const canvas = originalCanvasRef.current
    if (!canvas) return
    try {
      paintOriginalPreview(canvas, previewRaster)
    } catch (error) {
      releaseCanvas(canvas)
      setPreviewError(boundedError(error, '无法绘制原图预览。'))
    }
  }, [previewRaster])

  useEffect(() => {
    if (!previewRaster || !selectedOutput || !selectedFormat) return
    const canvas = previewCanvasRef.current
    if (!canvas) return
    try {
      paintRaster(canvas, previewRaster, previewOutputSpec(selectedOutput), flipHorizontal, flipVertical, selectedFormat, jpegBackground)
      setPreviewError('')
    } catch (error) {
      releaseCanvas(canvas)
      setPreviewError(boundedError(error, '无法生成输出预览。请降低输出尺寸。'))
    }
  }, [flipHorizontal, flipVertical, jpegBackground, previewRaster, selectedFormat, selectedOutput])

  const acceptFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length) return
      if (workPendingRef.current || archivePendingRef.current) {
        setOperationError('上一项图片工作仍在释放资源，请稍候再试。')
        return
      }
      if (processingRef.current || archivingRef.current) {
        setOperationError('请等待当前批处理或 ZIP 下载结束后再添加文件。')
        return
      }
      if (importingRef.current) {
        setOperationError('上一批文件仍在逐项检查，请稍候再添加。')
        return
      }

      importingRef.current = true
      workPendingRef.current = true
      setIsImporting(true)
      setOperationError('')
      const epoch = ++importEpochRef.current
      const incoming = Array.from(fileList)
      const rejectedNames: string[] = []
      let rejectedCount = 0
      let addedCount = 0

      for (const file of incoming) {
        if (!mountedRef.current || epoch !== importEpochRef.current) break
        const current = itemsRef.current
        const currentBytes = current.reduce((total, item) => total + item.size, 0)
        if (current.length >= MAX_FILES || currentBytes + file.size > MAX_BATCH_BYTES) {
          rejectedCount += 1
          if (rejectedNames.length < 3) rejectedNames.push((file.name || '未命名文件').slice(0, 40))
          continue
        }

        const id = `image-${Date.now().toString(36)}-${++itemSequenceRef.current}`
        const item: QueueItem = {
          id,
          file,
          name: file.name || 'image',
          mime: file.type,
          typeLabel: sourceTypeLabel(file.name, file.type),
          size: file.size,
          isGif: isGif(file),
          status: 'validating',
        }
        commitItems([...current, item])
        addedCount += 1
        if (!selectedIdRef.current) chooseItem(id)

        if (!isSupportedRaster(file)) {
          updateItem(id, (currentItem) => ({
            ...currentItem,
            status: 'error',
            validationError: '不支持该类型；请选择 PNG、JPG、WebP、GIF、BMP 或 AVIF 位图。',
          }))
          continue
        }
        if (file.size > MAX_FILE_BYTES) {
          updateItem(id, (currentItem) => ({
            ...currentItem,
            status: 'error',
            validationError: `文件为 ${formatBytes(file.size)}，超过单文件 ${formatBytes(MAX_FILE_BYTES)} 上限。`,
          }))
          continue
        }

        let raster: DecodedRaster | null = null
        try {
          raster = await decodeRaster(file, workSourceObjectUrlsRef.current)
          if (!mountedRef.current || epoch !== importEpochRef.current || !itemsRef.current.some((currentItem) => currentItem.id === id)) {
            disposeRaster(raster)
            raster = null
            break
          }
          if (raster.width > MAX_EDGE || raster.height > MAX_EDGE) {
            updateItem(id, (currentItem) => ({
              ...currentItem,
              status: 'error',
              validationError: `原图为 ${raster?.width.toLocaleString()} × ${raster?.height.toLocaleString()} px，单边最大支持 ${MAX_EDGE.toLocaleString()} px。`,
            }))
          } else {
            const width = raster.width
            const height = raster.height
            updateItem(id, (currentItem) => ({ ...currentItem, width, height, status: 'ready', validationError: undefined, error: undefined }))
          }
        } catch (error) {
          if (mountedRef.current && epoch === importEpochRef.current && itemsRef.current.some((currentItem) => currentItem.id === id)) {
            updateItem(id, (currentItem) => ({
              ...currentItem,
              status: 'error',
              validationError: boundedError(error, '无法解码；文件可能已损坏或当前浏览器不支持该编码。'),
            }))
          }
        } finally {
          disposeRaster(raster)
        }
      }

      workPendingRef.current = false
      if (mountedRef.current && epoch === importEpochRef.current) {
        importingRef.current = false
        setIsImporting(false)
        if (rejectedCount > 0) {
          const names = rejectedNames.join('、')
          const remainder = rejectedCount > rejectedNames.length ? ` 等 ${rejectedCount} 个文件` : ''
          setOperationError(`未加入 ${names}${remainder}：队列最多 ${MAX_FILES} 个文件且源文件合计不超过 ${formatBytes(MAX_BATCH_BYTES)}。`)
        }
        if (addedCount > 0) flash(`已加入 ${addedCount} 个文件`)
      }
    },
    [chooseItem, commitItems, flash, updateItem]
  )

  const handleFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      void acceptFiles(event.target.files)
      event.target.value = ''
    },
    [acceptFiles]
  )

  const downloadBlob = useCallback(
    (blob: Blob, filename: string) => {
      if (
        typeof document === 'undefined' ||
        typeof URL === 'undefined' ||
        typeof URL.createObjectURL !== 'function'
      ) {
        throw new Error('当前运行环境不支持本地下载。')
      }
      const objectUrl = URL.createObjectURL(blob)
      downloadUrlsRef.current.add(objectUrl)
      try {
        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = filename
        anchor.style.display = 'none'
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        let timer: ReturnType<typeof setTimeout>
        timer = setTimeout(() => {
          downloadTimersRef.current.delete(timer)
          downloadUrlsRef.current.delete(objectUrl)
          revokeObjectUrl(objectUrl)
        }, 1_500)
        downloadTimersRef.current.add(timer)
      } catch (error) {
        downloadUrlsRef.current.delete(objectUrl)
        revokeObjectUrl(objectUrl)
        throw error
      }
    },
    []
  )

  const downloadItem = useCallback(
    (item: QueueItem) => {
      if (!item.result) return
      setOperationError('')
      try {
        downloadBlob(item.result.blob, item.result.filename)
        flash(`已下载 ${item.result.filename}`)
      } catch (error) {
        setOperationError(boundedError(error, '单项下载失败。'))
      }
    },
    [downloadBlob, flash]
  )

  const runBatch = useCallback(async () => {
    if (workPendingRef.current || archivePendingRef.current) {
      setOperationError('上一项图片工作仍在释放资源，请稍候再试。')
      return
    }
    if (importingRef.current || processingRef.current || archivingRef.current) return
    const runSettings: BatchSettings = { ...settings }
    const inputError = settingsError(runSettings)
    if (inputError) {
      setOperationError(inputError)
      return
    }
    if (typeof document === 'undefined') {
      setOperationError('当前运行环境不支持图片编码。请在浏览器或桌面版中使用。')
      return
    }

    const resetItems = itemsRef.current.map((item) =>
      isSourceValid(item)
        ? { ...item, status: 'ready' as const, error: undefined, result: undefined }
        : item
    )
    const candidates = resetItems.filter(isSourceValid)
    if (candidates.length === 0) {
      setOperationError('队列中没有可处理的图片。')
      return
    }

    const epoch = ++runEpochRef.current
    archiveEpochRef.current += 1
    previewEpochRef.current += 1
    disposePreviewRaster()
    releaseCanvas(originalCanvasRef.current)
    releaseCanvas(previewCanvasRef.current)
    revokePreviewSourceObjectUrls()
    setPreviewRaster(null)
    setPreviewReload((value) => value + 1)
    revokeTransientDownloads()
    releaseProcessingResources()
    commitItems(resetItems)
    processingRef.current = true
    workPendingRef.current = true
    setIsProcessing(true)
    setOperationError('')
    setProgress({ completed: 0, total: candidates.length, currentName: '' })
    let completed = 0
    let succeeded = 0
    let failed = 0

    for (const candidate of candidates) {
      if (!mountedRef.current || epoch !== runEpochRef.current) break
      updateItem(candidate.id, (item) => ({ ...item, status: 'processing', error: undefined, result: undefined }))
      setProgress({ completed, total: candidates.length, currentName: candidate.name })
      let raster: DecodedRaster | null = null
      let canvas: HTMLCanvasElement | null = null
      try {
        raster = await decodeRaster(candidate.file, workSourceObjectUrlsRef.current)
        if (!mountedRef.current || epoch !== runEpochRef.current) return
        processingRasterRef.current = raster
        if (raster.width !== candidate.width || raster.height !== candidate.height) throw new Error('图片尺寸在处理前发生变化，请移除后重新添加。')
        const outputResult = getOutputSpec(candidate.width, candidate.height, runSettings)
        if (!outputResult.output) throw new Error(outputResult.error ?? '输出尺寸无效。')
        const output = outputResult.output
        const format = resolveExportFormat(candidate, runSettings.exportChoice)
        if (!format) throw new Error('此源格式无法原格式重编码；请明确选择 PNG、JPEG 或 WebP。')
        const option = formatOption(format)
        canvas = document.createElement('canvas')
        processingCanvasRef.current = canvas
        paintRaster(canvas, raster, output, runSettings.flipHorizontal, runSettings.flipVertical, format, runSettings.jpegBackground)
        const blob = await canvasToBlob(canvas, option.mime, format === 'png' ? undefined : runSettings.quality / 100)
        if (!mountedRef.current || epoch !== runEpochRef.current) return
        if (blob.type.toLowerCase() !== option.mime) throw new Error(`当前浏览器不支持 ${option.shortLabel} 编码。`)
        const result: BatchResult = {
          blob,
          filename: downloadName(candidate, output, format, runSettings),
          format,
          mime: blob.type,
          width: output.width,
          height: output.height,
          size: blob.size,
        }
        updateItem(candidate.id, (item) => ({ ...item, status: 'success', error: undefined, result }))
        succeeded += 1
      } catch (error) {
        if (!mountedRef.current || epoch !== runEpochRef.current) return
        updateItem(candidate.id, (item) => ({ ...item, status: 'error', error: boundedError(error, '处理失败。'), result: undefined }))
        failed += 1
      } finally {
        if (processingRasterRef.current === raster) processingRasterRef.current = null
        disposeRaster(raster)
        if (processingCanvasRef.current === canvas) processingCanvasRef.current = null
        releaseCanvas(canvas)
        if (mountedRef.current && epoch === runEpochRef.current) {
          completed += 1
          setProgress({ completed, total: candidates.length, currentName: '' })
        } else {
          workPendingRef.current = false
        }
      }
    }

    workPendingRef.current = false
    if (mountedRef.current && epoch === runEpochRef.current) {
      processingRef.current = false
      setIsProcessing(false)
      setProgress({ completed, total: candidates.length, currentName: '' })
      flash(`批处理完成：${succeeded} 个成功${failed ? `，${failed} 个失败` : ''}`)
    }
  }, [commitItems, disposePreviewRaster, flash, releaseProcessingResources, revokePreviewSourceObjectUrls, revokeTransientDownloads, settings, updateItem])

  const downloadAll = useCallback(async () => {
    if (archivePendingRef.current || workPendingRef.current) {
      setOperationError('上一项后台工作仍在释放资源，请稍候再试。')
      return
    }
    if (processingRef.current || importingRef.current || archivingRef.current) return
    const entries: ZipEntry[] = []
    for (const item of itemsRef.current) {
      if (item.status === 'success' && item.result) entries.push({ name: item.result.filename, blob: item.result.blob })
    }
    if (entries.length === 0) {
      setOperationError('没有可下载的成功结果。')
      return
    }

    const epoch = ++archiveEpochRef.current
    archivingRef.current = true
    archivePendingRef.current = true
    setIsArchiving(true)
    setOperationError('')
    try {
      const zip = await createStoreZip(entries, () => mountedRef.current && epoch === archiveEpochRef.current)
      if (!zip || !mountedRef.current || epoch !== archiveEpochRef.current) return
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      downloadBlob(zip, `ttool-images-${stamp}.zip`)
      flash(`已下载包含 ${entries.length} 个结果的 ZIP`)
    } catch (error) {
      if (mountedRef.current && epoch === archiveEpochRef.current) setOperationError(boundedError(error, 'ZIP 生成失败，请逐项下载。'))
    } finally {
      archivePendingRef.current = false
      if (mountedRef.current && epoch === archiveEpochRef.current) {
        archivingRef.current = false
        setIsArchiving(false)
      }
    }
  }, [downloadBlob, flash])

  const removeItem = useCallback(
    (id: string) => {
      const wasBusy = importingRef.current || processingRef.current || archivingRef.current
      cancelMutableWork()
      setIsImporting(false)
      setIsProcessing(false)
      setIsArchiving(false)
      setProgress({ completed: 0, total: 0, currentName: '' })
      setPreviewRaster(null)
      const current = itemsRef.current
      const removedIndex = current.findIndex((item) => item.id === id)
      const next = current
        .filter((item) => item.id !== id)
        .map((item) => {
          if (item.status === 'processing') return { ...item, status: 'ready' as const }
          if (item.status === 'validating') {
            return {
              ...item,
              status: 'error' as const,
              validationError: '文件检查已取消，请移除后重新添加。',
            }
          }
          return item
        })
      commitItems(next)
      if (selectedIdRef.current === id) {
        const fallback = next[Math.min(Math.max(removedIndex, 0), Math.max(next.length - 1, 0))]
        chooseItem(fallback?.id ?? null)
      } else {
        setPreviewReload((value) => value + 1)
      }
      setOperationError(wasBusy ? '已取消进行中的工作并移除该项。' : '')
    },
    [cancelMutableWork, chooseItem, commitItems]
  )

  const clearAll = useCallback(() => {
    const hadItems = itemsRef.current.length > 0
    cancelMutableWork()
    commitItems([])
    chooseItem(null)
    setPreviewRaster(null)
    setIsImporting(false)
    setIsProcessing(false)
    setIsArchiving(false)
    setProgress({ completed: 0, total: 0, currentName: '' })
    setPreviewError('')
    setOperationError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (hadItems) flash('已清空图片队列')
  }, [cancelMutableWork, chooseItem, commitItems, flash])

  const resetSettings = useCallback(() => {
    setSizeMode('original')
    setPercentageText('80')
    setMaxEdgeText('1920')
    setExactWidthText('1920')
    setExactHeightText('1080')
    setAspectLocked(true)
    setRotation(0)
    setFlipHorizontal(false)
    setFlipVertical(false)
    setExportChoice('source')
    setQuality(92)
    setJpegBackground('#ffffff')
    setPreviewError('')
    setOperationError('')
  }, [])

  const updateExactDimension = useCallback(
    (axis: 'width' | 'height', value: string) => {
      if (axis === 'width') setExactWidthText(value)
      else setExactHeightText(value)
      if (!aspectLocked || !selectedItem || !isSourceValid(selectedItem)) return
      const numeric = loosePositiveInteger(value)
      if (numeric === null) return
      const paired = Math.max(
        1,
        axis === 'width'
          ? Math.round((numeric * selectedItem.height) / selectedItem.width)
          : Math.round((numeric * selectedItem.width) / selectedItem.height)
      )
      if (Number.isSafeInteger(paired)) {
        if (axis === 'width') setExactHeightText(String(paired))
        else setExactWidthText(String(paired))
      }
    },
    [aspectLocked, selectedItem]
  )

  const setLockedAspect = useCallback(
    (locked: boolean) => {
      setAspectLocked(locked)
      if (!locked || !selectedItem || !isSourceValid(selectedItem)) return
      const width = loosePositiveInteger(exactWidthText)
      if (width === null) return
      setExactHeightText(String(Math.max(1, Math.round((width * selectedItem.height) / selectedItem.width))))
    },
    [exactWidthText, selectedItem]
  )

  const rotate = useCallback((direction: 1 | -1) => {
    setRotation((current) => ((current + direction * 90 + 360) % 360) as Rotation)
  }, [])

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
      void acceptFiles(event.dataTransfer.files)
    },
    [acceptFiles]
  )

  const pageButtonStyle: CSSProperties = { whiteSpace: 'nowrap' }
  const outputUnavailable = selectedItem && isSourceValid(selectedItem) && exportChoice === 'source' && !selectedFormat
  const selectedGifNotice = selectedItem?.isGif

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
          title="图片批量压缩"
          subtitle="本地批量缩放 · 旋转翻转 · PNG / JPEG / WebP 导出"
          right={
            <div className="image-tool-actions">
              <button type="button" className="image-tool-button" style={pageButtonStyle} onClick={() => fileInputRef.current?.click()} disabled={busy}>
                添加图片
              </button>
              <button type="button" className="image-tool-button" style={pageButtonStyle} onClick={resetSettings} disabled={isProcessing}>
                重置设置
              </button>
              <button type="button" className="image-tool-button image-tool-button-primary" style={pageButtonStyle} onClick={() => void runBatch()} disabled={!canProcess}>
                {isProcessing ? '正在处理…' : hasCompletedResults ? '重新批量处理' : '开始批量处理'}
              </button>
              <button type="button" className="image-tool-button" style={pageButtonStyle} onClick={() => void downloadAll()} disabled={!hasCompletedResults || busy}>
                {isArchiving ? '正在生成 ZIP…' : `下载全部${hasCompletedResults ? `（${successfulItems.length}）` : ''}`}
              </button>
            </div>
          }
        />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />

        <div className="image-tool-layout">
          <section className="image-tool-column" aria-label="图片队列">
            <Panel label="队列" right={<span className="image-tool-code">{items.length}/{MAX_FILES}</span>} flex={false}>
              <button type="button" className="image-tool-dropzone" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                <span>
                  <strong>{isImporting ? '正在逐项检查…' : '拖放或选择多张图片'}</strong>
                  <span>最多 {MAX_FILES} 张 · 合计 {formatBytes(MAX_BATCH_BYTES)} · 单张 {formatBytes(MAX_FILE_BYTES)}</span>
                </span>
              </button>
              <div className="image-tool-queue-toolbar">
                <span>源文件 {formatBytes(sourceBytes)}；不会上传或修改</span>
                <button type="button" className="image-tool-button" onClick={clearAll} disabled={items.length === 0}>清空</button>
              </div>
              {items.length > 0 ? (
                <ul className="image-tool-queue">
                  {items.map((item) => {
                    const itemError = item.validationError ?? item.error
                    return (
                      <li key={item.id} className={`image-tool-queue-item${selectedId === item.id ? ' is-selected' : ''}`}>
                        <button type="button" className="image-tool-queue-select" onClick={() => chooseItem(item.id)} aria-pressed={selectedId === item.id}>
                          <span className="image-tool-queue-top">
                            <span className="image-tool-queue-name" title={item.name}>{item.name}</span>
                            <span className={`image-tool-status image-tool-status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
                          </span>
                          <span className="image-tool-queue-meta">
                            {item.typeLabel} · {item.width && item.height ? `${item.width.toLocaleString()} × ${item.height.toLocaleString()} px` : '尺寸未知'} · {formatBytes(item.size)}
                          </span>
                          {item.result ? (
                            <span className="image-tool-queue-result">
                              → {formatOption(item.result.format).shortLabel} · {item.result.width.toLocaleString()} × {item.result.height.toLocaleString()} px · {formatBytes(item.result.size)} · {formatSavings(item.size, item.result.size)}
                            </span>
                          ) : null}
                          {itemError ? <span className="image-tool-queue-error">{itemError}</span> : null}
                        </button>
                        <span className="image-tool-queue-side">
                          {item.result ? (
                            <button type="button" className="image-tool-button image-tool-icon-button" onClick={() => downloadItem(item)} disabled={busy} aria-label={`下载 ${item.name}`} title="下载此结果">↓</button>
                          ) : null}
                          <button type="button" className="image-tool-button image-tool-icon-button" onClick={() => removeItem(item.id)} aria-label={`移除 ${item.name}`} title="移除此项">×</button>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <div className="image-tool-empty" style={{ margin: '4px auto 18px' }}>
                  <span>队列为空。无效或损坏文件也会保留为可移除的错误项。</span>
                </div>
              )}
              {(progress.total > 0 || isImporting) ? (
                <div className="image-tool-progress" aria-live="polite">
                  <div className="image-tool-progress-line">
                    <span>{isImporting ? '正在读取图片尺寸' : progress.currentName || '批处理进度'}</span>
                    <span>{isImporting ? '逐张检查' : `${progress.completed}/${progress.total}`}</span>
                  </div>
                  {!isImporting ? <progress max={Math.max(1, progress.total)} value={progress.completed} aria-label="批处理进度" /> : null}
                </div>
              ) : null}
            </Panel>
          </section>

          <section className="image-tool-column" aria-label="所选图片预览">
            <div className="image-tool-stages">
              <div className="image-tool-stage">
                <Panel label="所选原图" right={selectedItem ? <span className="image-tool-code">{selectedItem.typeLabel}</span> : undefined} flex={false}>
                  <div className="image-tool-canvas-area">
                    {selectedItem && previewRaster ? (
                      <canvas ref={originalCanvasRef} className="image-tool-original" role="img" aria-label={`原图预览：${selectedItem.name}`} />
                    ) : (
                      <div className="image-tool-empty">
                        <span className="image-tool-empty-mark">▧</span>
                        <span>{selectedItem?.status === 'validating' ? '正在检查所选图片…' : selectedItem && !isSourceValid(selectedItem) ? '该项无法预览，请查看队列错误。' : '从队列选择一张有效图片。'}</span>
                      </div>
                    )}
                  </div>
                  {selectedItem ? (
                    <div className="image-tool-meta">
                      <div className="image-tool-meta-item"><span className="image-tool-meta-label">文件名</span><span className="image-tool-meta-value" title={selectedItem.name}>{selectedItem.name}</span></div>
                      <div className="image-tool-meta-item"><span className="image-tool-meta-label">源尺寸</span><span className="image-tool-meta-value">{selectedItem.width && selectedItem.height ? `${selectedItem.width.toLocaleString()} × ${selectedItem.height.toLocaleString()} px` : '—'}</span></div>
                      <div className="image-tool-meta-item"><span className="image-tool-meta-label">类型</span><span className="image-tool-meta-value">{selectedItem.typeLabel}</span></div>
                      <div className="image-tool-meta-item"><span className="image-tool-meta-label">源大小</span><span className="image-tool-meta-value">{formatBytes(selectedItem.size)}</span></div>
                    </div>
                  ) : null}
                </Panel>
              </div>

              <div className="image-tool-stage">
                <Panel label="当前设置预览" right={selectedOutput ? <span className="image-tool-code">{selectedOutput.width.toLocaleString()} × {selectedOutput.height.toLocaleString()}</span> : undefined} flex={false}>
                  <div className="image-tool-canvas-area">
                    {selectedItem && previewRaster && selectedOutput && selectedFormat ? (
                      <canvas ref={previewCanvasRef} className="image-tool-preview" role="img" aria-label={`输出预览：${selectedOutput.width} × ${selectedOutput.height} 像素`} />
                    ) : (
                      <div className="image-tool-empty">
                        <span className="image-tool-empty-mark">↗</span>
                        <span>{outputUnavailable ? '此格式无法保持原格式，请明确选择 PNG、JPEG 或 WebP。' : selectedOutputResult.error || '选择有效图片后显示当前统一设置。'}</span>
                      </div>
                    )}
                  </div>
                  <div className="image-tool-summary">
                    <span>{selectedOutput && selectedFormat ? `${formatMegapixels(selectedOutput.pixels)} · ${formatOption(selectedFormat).label}` : '等待可用输出设置'}</span>
                    <span>{selectedItem?.result ? `上次 ${formatBytes(selectedItem.result.size)}` : '尚未处理'}</span>
                  </div>
                </Panel>
              </div>
            </div>

            {hasCompletedResults ? (
              <div className="image-tool-results">
                <div className="image-tool-alert">
                  <strong>批量结果：</strong>{successfulItems.length} 个成功，{formatBytes(aggregate.inputBytes)} → {formatBytes(aggregate.outputBytes)}，{formatSavings(aggregate.inputBytes, aggregate.outputBytes)}。数值来自实际编码 Blob。
                </div>
              </div>
            ) : null}
          </section>

          <aside className="image-tool-settings">
            <Panel label="统一设置" flex={false}>
              <div className="image-tool-controls">
                <div className="image-tool-control-group">
                  <span className="image-tool-control-title">尺寸</span>
                  <div className="image-tool-field">
                    <label htmlFor="image-tool-size-mode">调整方式</label>
                    <select id="image-tool-size-mode" className="image-tool-select" value={sizeMode} onChange={(event) => setSizeMode(event.target.value as SizeMode)} disabled={isProcessing}>
                      <option value="original">保持各自原尺寸</option>
                      <option value="percentage">按百分比</option>
                      <option value="max-edge">限制最长边（不放大）</option>
                      <option value="exact">固定宽度与高度</option>
                    </select>
                  </div>
                  {sizeMode === 'percentage' ? (
                    <div className="image-tool-field">
                      <label htmlFor="image-tool-percentage">缩放百分比（1–{MAX_PERCENTAGE}）</label>
                      <input id="image-tool-percentage" className="image-tool-number" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={percentageText} onChange={(event) => setPercentageText(event.target.value)} disabled={isProcessing} />
                    </div>
                  ) : null}
                  {sizeMode === 'max-edge' ? (
                    <div className="image-tool-field">
                      <label htmlFor="image-tool-max-edge">最长边像素</label>
                      <input id="image-tool-max-edge" className="image-tool-number" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={5} value={maxEdgeText} onChange={(event) => setMaxEdgeText(event.target.value)} disabled={isProcessing} />
                    </div>
                  ) : null}
                  {sizeMode === 'exact' ? (
                    <>
                      <div className="image-tool-dimensions">
                        <div className="image-tool-field">
                          <label htmlFor="image-tool-width">宽度</label>
                          <input id="image-tool-width" className="image-tool-number" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={5} value={exactWidthText} onChange={(event) => updateExactDimension('width', event.target.value)} disabled={isProcessing} />
                        </div>
                        <span className="image-tool-dimension-sign">×</span>
                        <div className="image-tool-field">
                          <label htmlFor="image-tool-height">高度</label>
                          <input id="image-tool-height" className="image-tool-number" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={5} value={exactHeightText} onChange={(event) => updateExactDimension('height', event.target.value)} disabled={isProcessing} />
                        </div>
                      </div>
                      <label className="image-tool-lock">
                        <input type="checkbox" checked={aspectLocked} onChange={(event) => setLockedAspect(event.target.checked)} disabled={isProcessing || !selectedItem || !isSourceValid(selectedItem)} />
                        按所选图片比例联动输入
                      </label>
                    </>
                  ) : null}
                  <span className="image-tool-note">每边最大 {MAX_EDGE.toLocaleString()} px，输出最大 {formatMegapixels(MAX_OUTPUT_PIXELS)}。最长边模式绝不放大小图。</span>
                </div>

                <div className="image-tool-control-group">
                  <span className="image-tool-control-title">旋转与翻转</span>
                  <div className="image-tool-transform-row">
                    <button type="button" className="image-tool-button" onClick={() => rotate(-1)} disabled={isProcessing}>↶ 左转 90°</button>
                    <button type="button" className="image-tool-button" onClick={() => rotate(1)} disabled={isProcessing}>右转 90° ↷</button>
                    <button type="button" className={`image-tool-button${flipHorizontal ? ' is-active' : ''}`} onClick={() => setFlipHorizontal((value) => !value)} disabled={isProcessing} aria-pressed={flipHorizontal}>水平翻转</button>
                    <button type="button" className={`image-tool-button${flipVertical ? ' is-active' : ''}`} onClick={() => setFlipVertical((value) => !value)} disabled={isProcessing} aria-pressed={flipVertical}>垂直翻转</button>
                  </div>
                  <span className="image-tool-note">当前旋转 {rotation}°；变换会统一应用到每个有效项。</span>
                </div>

                <div className="image-tool-control-group">
                  <span className="image-tool-control-title">导出与压缩</span>
                  <div className="image-tool-field">
                    <label htmlFor="image-tool-format">输出格式</label>
                    <select id="image-tool-format" className="image-tool-select" value={exportChoice} onChange={(event) => setExportChoice(event.target.value as ExportChoice)} disabled={isProcessing}>
                      <option value="source">保持原格式（PNG / JPEG / WebP）</option>
                      {FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <span className="image-tool-note">选择固定格式即明确转换全部结果；GIF、BMP、AVIF 无法“保持原格式”，会逐项提示。</span>
                  </div>
                  <div className="image-tool-field">
                    <label htmlFor="image-tool-quality">JPEG / WebP 有损质量</label>
                    <div className="image-tool-range-row">
                      <input id="image-tool-quality" className="image-tool-range" type="range" min="1" max="100" step="1" value={quality} onChange={(event) => setQuality(Number(event.target.value))} disabled={isProcessing || exportChoice === 'png'} />
                      <span className="image-tool-quality">{exportChoice === 'png' ? '无损' : `${quality}%`}</span>
                    </div>
                  </div>
                  <div className="image-tool-field">
                    <label htmlFor="image-tool-background">JPEG 背景</label>
                    <div className="image-tool-background">
                      <input id="image-tool-background" className="image-tool-color" type="color" value={jpegBackground} onChange={(event) => setJpegBackground(event.target.value)} disabled={isProcessing || exportChoice === 'png' || exportChoice === 'webp'} />
                      <span className="image-tool-code">{jpegBackground.toUpperCase()}</span>
                    </div>
                    <span className="image-tool-note">JPEG 不支持透明像素，会使用此不透明背景。PNG 是无损重编码，结果可能变大。</span>
                  </div>
                </div>
              </div>
              {selectedGifNotice ? <div className="image-tool-alert"><strong>GIF 提示：</strong>动画 GIF 会按首帧作为静态图片处理，动画不会保留。</div> : null}
            </Panel>
          </aside>
        </div>

        <div className="image-tool-alerts" aria-live="polite">
          {currentSettingsError ? <div className="image-tool-alert" role="alert"><strong>设置无效：</strong>{currentSettingsError}</div> : null}
          {previewError ? <div className="image-tool-alert" role="alert"><strong>预览不可用：</strong>{previewError}</div> : null}
          {operationError ? <div className="image-tool-alert" role="alert"><strong>提示：</strong>{operationError}</div> : null}
        </div>
      </div>
    </ToolPage>
  )
}

registerTool({
  id: 'image-tool',
  name: '图片处理',
  desc: '批量压缩 · 调整尺寸 · 旋转翻转 · 格式导出',
  glyph: '▧',
  cat: '设计',
  hue: 'pink',
  order: 80,
  component: ImageTool,
  keywords: 'image picture photo batch compress compressor compression resize rotate flip convert optimize optimizer png jpg jpeg webp gif bmp avif 图片 批量 压缩 图片压缩 批量压缩 tupian piliang yasuo',
})
