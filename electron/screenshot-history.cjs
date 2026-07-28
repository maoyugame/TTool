'use strict'

// 截图历史是主进程私有存储：图片只由安全 id 推导路径，元数据经同目录临时文件原子替换。
// 不把绝对路径写入元数据，避免损坏/篡改的 metadata 影响任何文件系统目标。
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const HISTORY_SCHEMA_VERSION = 1
const METADATA_FILE = 'metadata.json'
const IMAGE_DIRECTORY = 'images'
const IMAGE_SUFFIX = '.png'
const MAX_HISTORY_ITEMS = 10_000
const MAX_HISTORY_BYTES = 2 * 1024 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 1_000_000
const MAX_HISTORY_ID_LENGTH = 128
const MAX_SOURCE_LENGTH = 120

const DEFAULT_HISTORY_LIMITS = Object.freeze({
  maxItems: 100,
  maxBytes: 128 * 1024 * 1024,
})

let temporarySequence = 0

function historyError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = finiteNumber(value)
  if (number === null) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(number)))
}

function optionalInteger(value, minimum, maximum) {
  const number = finiteNumber(value)
  if (number === null) return undefined
  const integer = Math.floor(number)
  if (integer < minimum || integer > maximum) return undefined
  return integer
}

function optionalTimestamp(value) {
  return optionalInteger(value, 0, Number.MAX_SAFE_INTEGER)
}

function normalizeBoolean(value, fallback) {
  if (value === true || value === false) return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
}

function optionalText(value, maximumLength) {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > maximumLength) return undefined
  return text
}

function normalizeHistoryLimits(raw) {
  const source = isRecord(raw) ? raw : {}
  return {
    maxItems: boundedInteger(source.maxItems, DEFAULT_HISTORY_LIMITS.maxItems, 1, MAX_HISTORY_ITEMS),
    maxBytes: boundedInteger(source.maxBytes, DEFAULT_HISTORY_LIMITS.maxBytes, 1, MAX_HISTORY_BYTES),
  }
}

// 文件名仅允许一个受控段；绝不接受路径分隔符、点段或扩展名。
function safeHistoryId(value) {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > MAX_HISTORY_ID_LENGTH) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) return null
  return value
}

function requireHistoryId(value) {
  const id = safeHistoryId(value)
  if (!id) throw historyError('HISTORY_INVALID_ID', '截图历史 id 非法')
  return id
}

function containedChild(root, child) {
  const base = path.resolve(root)
  const target = path.resolve(base, child)
  const relative = path.relative(base, target)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw historyError('HISTORY_UNSAFE_PATH', '截图历史路径越界')
  }
  return target
}

function lstatRegularFile(file, missingIsNull = false) {
  let stat
  try {
    stat = fs.lstatSync(file)
  } catch (error) {
    if (missingIsNull && error && error.code === 'ENOENT') return null
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw historyError('HISTORY_UNSAFE_PATH', '截图历史文件不是安全的普通文件')
  }
  return stat
}

function prepareStore(rootDir) {
  if (typeof rootDir !== 'string' || rootDir.trim() === '') {
    throw historyError('HISTORY_INVALID_ROOT', '截图历史目录无效')
  }

  const requestedRoot = path.resolve(rootDir)
  fs.mkdirSync(requestedRoot, { recursive: true, mode: 0o700 })
  const requestedStat = fs.lstatSync(requestedRoot)
  if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory()) {
    throw historyError('HISTORY_UNSAFE_PATH', '截图历史根目录不安全')
  }

  const root = typeof fs.realpathSync.native === 'function'
    ? fs.realpathSync.native(requestedRoot)
    : fs.realpathSync(requestedRoot)
  const imagesDir = containedChild(root, IMAGE_DIRECTORY)
  fs.mkdirSync(imagesDir, { recursive: true, mode: 0o700 })
  const imagesStat = fs.lstatSync(imagesDir)
  if (imagesStat.isSymbolicLink() || !imagesStat.isDirectory()) {
    throw historyError('HISTORY_UNSAFE_PATH', '截图历史图片目录不安全')
  }

  return Object.freeze({
    rootDir: root,
    imagesDir,
    metadataPath: containedChild(root, METADATA_FILE),
  })
}

function imagePathFor(store, id) {
  return containedChild(store.imagesDir, requireHistoryId(id) + IMAGE_SUFFIX)
}

function nextTemporaryPath(target) {
  const parent = path.dirname(target)
  const base = path.basename(target)
  const entropy = crypto.randomBytes(6).toString('hex')
  const name = '.' + base + '.' + process.pid + '.' + (++temporarySequence) + '.' + entropy + '.tmp'
  return containedChild(parent, name)
}

function fsyncDirectory(directory) {
  // Windows 不支持对目录 fsync；文件数据已 fsync，目录同步尽力而为即可。
  let fd
  try {
    fd = fs.openSync(directory, 'r')
    fs.fsyncSync(fd)
  } catch {
    /* best effort */
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        /* best effort */
      }
    }
  }
}

function atomicWriteFile(file, content) {
  const temporary = nextTemporaryPath(file)
  let fd
  try {
    fd = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(fd, content)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(temporary, file)
    fsyncDirectory(path.dirname(file))
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        /* best effort */
      }
    }
    try {
      fs.rmSync(temporary, { force: true })
    } catch {
      /* best effort */
    }
    throw error
  }
}

function cloneItem(item) {
  const clone = {
    id: item.id,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    byteLength: item.byteLength,
    favorite: item.favorite,
  }
  if (item.width !== undefined) clone.width = item.width
  if (item.height !== undefined) clone.height = item.height
  if (item.displayId !== undefined) clone.displayId = item.displayId
  if (item.source !== undefined) clone.source = item.source
  if (item.deletedAt !== undefined) clone.deletedAt = item.deletedAt
  return clone
}

function compareNewestFirst(left, right) {
  if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

function compareOldestFirst(left, right) {
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

function compareDeletedFirst(left, right) {
  const leftAt = left.deletedAt === undefined ? left.createdAt : left.deletedAt
  const rightAt = right.deletedAt === undefined ? right.createdAt : right.deletedAt
  if (leftAt !== rightAt) return leftAt - rightAt
  return compareOldestFirst(left, right)
}

function publicItem(item) {
  return cloneItem(item)
}

function emptyMetadata(now) {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: now,
    items: [],
  }
}

function canonicalMetadata(items, updatedAt) {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt,
    items: items.map(cloneItem).sort(compareNewestFirst),
  }
}

function normalizeStoredItem(raw, store) {
  if (!isRecord(raw)) return null
  const id = safeHistoryId(raw.id)
  const createdAt = optionalTimestamp(raw.createdAt)
  if (!id || createdAt === undefined) return null

  const file = imagePathFor(store, id)
  const stat = lstatRegularFile(file, true)
  if (!stat) return null

  const item = {
    id,
    createdAt,
    updatedAt: optionalTimestamp(raw.updatedAt) ?? createdAt,
    byteLength: stat.size,
    favorite: normalizeBoolean(raw.favorite, false),
  }
  const width = optionalInteger(raw.width, 1, MAX_IMAGE_DIMENSION)
  const height = optionalInteger(raw.height, 1, MAX_IMAGE_DIMENSION)
  const displayId = optionalInteger(raw.displayId, -2_147_483_648, 2_147_483_647)
  const source = optionalText(raw.source, MAX_SOURCE_LENGTH)
  const deletedAt = optionalTimestamp(raw.deletedAt)
  if (width !== undefined) item.width = width
  if (height !== undefined) item.height = height
  if (displayId !== undefined) item.displayId = displayId
  if (source !== undefined) item.source = source
  if (deletedAt !== undefined) item.deletedAt = deletedAt
  return item
}

function readMetadata(store, now) {
  const stat = lstatRegularFile(store.metadataPath, true)
  if (!stat) {
    return {
      metadata: emptyMetadata(now),
      malformed: false,
      needsRepair: false,
    }
  }

  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(store.metadataPath, 'utf8'))
  } catch {
    return {
      metadata: emptyMetadata(now),
      malformed: true,
      needsRepair: false,
    }
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== HISTORY_SCHEMA_VERSION || !Array.isArray(parsed.items)) {
    return {
      metadata: emptyMetadata(now),
      malformed: true,
      needsRepair: false,
    }
  }

  const seen = new Set()
  const items = []
  let needsRepair = optionalTimestamp(parsed.updatedAt) === undefined
  for (const raw of parsed.items) {
    let item
    try {
      item = normalizeStoredItem(raw, store)
    } catch (error) {
      // 元数据中的 id 已经校验；若落盘图片被替换为符号链接，忽略该条目而不跟随它。
      if (!error || error.code !== 'HISTORY_UNSAFE_PATH') throw error
      item = null
    }
    if (!item || seen.has(item.id)) {
      needsRepair = true
      continue
    }
    seen.add(item.id)
    if (raw.byteLength !== item.byteLength) needsRepair = true
    items.push(item)
  }

  return {
    metadata: canonicalMetadata(items, optionalTimestamp(parsed.updatedAt) ?? now),
    malformed: false,
    needsRepair,
  }
}

function retentionResult(items, limits) {
  const discarded = new Set()
  let byteLength = items.reduce((sum, item) => sum + item.byteLength, 0)
  let count = items.length
  const candidates = [
    ...items.filter((item) => item.deletedAt !== undefined).sort(compareDeletedFirst),
    ...items.filter((item) => item.deletedAt === undefined && !item.favorite).sort(compareOldestFirst),
    ...items.filter((item) => item.deletedAt === undefined && item.favorite).sort(compareOldestFirst),
  ]

  for (const item of candidates) {
    if (count <= limits.maxItems && byteLength <= limits.maxBytes) break
    discarded.add(item.id)
    count -= 1
    byteLength -= item.byteLength
  }

  return {
    items: items.filter((item) => !discarded.has(item.id)),
    discarded: [...discarded],
  }
}

function safeNow(clock) {
  const value = finiteNumber(clock())
  return value === null ? Date.now() : Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)))
}

function resolveCreateArguments(rootOrOptions, maybeOptions) {
  if (typeof rootOrOptions === 'string') {
    return { ...(isRecord(maybeOptions) ? maybeOptions : {}), rootDir: rootOrOptions }
  }
  return isRecord(rootOrOptions) ? rootOrOptions : {}
}

function createScreenshotHistory(rootOrOptions, maybeOptions) {
  const options = resolveCreateArguments(rootOrOptions, maybeOptions)
  const store = prepareStore(options.rootDir)
  const limits = normalizeHistoryLimits(options.limits || options)
  const clock = typeof options.now === 'function' ? options.now : Date.now
  const initialNow = safeNow(clock)
  const loaded = readMetadata(store, initialNow)
  let metadata = loaded.metadata
  let malformedMetadata = loaded.malformed

  function writeMetadata(nextMetadata, discardedIds = []) {
    if (malformedMetadata) {
      const source = lstatRegularFile(store.metadataPath, true)
      if (source) {
        const backupName = 'metadata.corrupt-' + safeNow(clock) + '-' + process.pid + '-' + (++temporarySequence) + '.json'
        const backup = containedChild(store.rootDir, backupName)
        fs.renameSync(store.metadataPath, backup)
      }
      malformedMetadata = false
    }
    atomicWriteFile(store.metadataPath, JSON.stringify(nextMetadata, null, 2) + '\n')
    metadata = nextMetadata
    for (const id of discardedIds) {
      const file = imagePathFor(store, id)
      let stat
      try {
        stat = lstatRegularFile(file, true)
      } catch (error) {
        if (error && error.code === 'HISTORY_UNSAFE_PATH') continue
        throw error
      }
      if (stat) fs.unlinkSync(file)
    }
  }

  function persistRetained(items, discardedIds = []) {
    const next = canonicalMetadata(items, safeNow(clock))
    writeMetadata(next, discardedIds)
    return next
  }

  // 有效元数据可在启动时按当前容量限制修复；损坏文件先保留原件，待下一次写入时备份。
  if (!malformedMetadata) {
    const retained = retentionResult(metadata.items, limits)
    if (loaded.needsRepair || retained.discarded.length > 0) {
      persistRetained(retained.items, retained.discarded)
    }
  }

  function findItem(id, includeDeleted) {
    const safeId = requireHistoryId(id)
    const item = metadata.items.find((candidate) => candidate.id === safeId)
    if (!item || (!includeDeleted && item.deletedAt !== undefined)) return null
    return item
  }

  function ensureReadableItem(id, includeDeleted) {
    const item = findItem(id, includeDeleted)
    if (!item) return null
    const file = imagePathFor(store, item.id)
    if (!lstatRegularFile(file, true)) return null
    return item
  }

  function makeId() {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const id = 'shot_' + safeNow(clock).toString(36) + '_' + crypto.randomBytes(8).toString('hex')
      if (!metadata.items.some((item) => item.id === id) && !lstatRegularFile(imagePathFor(store, id), true)) {
        return id
      }
    }
    throw historyError('HISTORY_ID_COLLISION', '无法生成唯一的截图历史 id')
  }

  function addPng(png, rawOptions = {}) {
    const bytes = Buffer.isBuffer(png) ? Buffer.from(png) : Buffer.from(png || [])
    if (bytes.length === 0) throw historyError('HISTORY_INVALID_IMAGE', '截图 PNG 为空')
    if (bytes.length > limits.maxBytes) throw historyError('HISTORY_IMAGE_TOO_LARGE', '截图超过历史容量上限')

    const itemOptions = isRecord(rawOptions) ? rawOptions : {}
    const id = hasOwn(itemOptions, 'id') ? requireHistoryId(itemOptions.id) : makeId()
    if (metadata.items.some((item) => item.id === id) || lstatRegularFile(imagePathFor(store, id), true)) {
      throw historyError('HISTORY_ID_EXISTS', '截图历史 id 已存在')
    }

    const createdAt = optionalTimestamp(itemOptions.createdAt) ?? safeNow(clock)
    const item = {
      id,
      createdAt,
      updatedAt: createdAt,
      byteLength: bytes.length,
      favorite: normalizeBoolean(itemOptions.favorite, false),
    }
    const width = optionalInteger(itemOptions.width, 1, MAX_IMAGE_DIMENSION)
    const height = optionalInteger(itemOptions.height, 1, MAX_IMAGE_DIMENSION)
    const displayId = optionalInteger(itemOptions.displayId, -2_147_483_648, 2_147_483_647)
    const source = optionalText(itemOptions.source, MAX_SOURCE_LENGTH)
    if (width !== undefined) item.width = width
    if (height !== undefined) item.height = height
    if (displayId !== undefined) item.displayId = displayId
    if (source !== undefined) item.source = source

    const imagePath = imagePathFor(store, id)
    atomicWriteFile(imagePath, bytes)
    const retained = retentionResult([...metadata.items.map(cloneItem), item], limits)
    const saved = retained.items.find((candidate) => candidate.id === id)
    if (!saved) {
      try {
        fs.unlinkSync(imagePath)
      } catch {
        /* next valid startup can clean an orphan */
      }
      throw historyError('HISTORY_RETENTION_REJECTED', '收藏截图已占满历史容量')
    }

    try {
      persistRetained(retained.items, retained.discarded)
    } catch (error) {
      try {
        fs.unlinkSync(imagePath)
      } catch {
        /* preserve the original write failure */
      }
      throw error
    }
    return publicItem(saved)
  }

  function list(rawOptions = {}) {
    const listOptions = isRecord(rawOptions) ? rawOptions : {}
    const includeDeleted = normalizeBoolean(listOptions.includeDeleted, false)
    const favoritesOnly = normalizeBoolean(listOptions.favoritesOnly, false)
    const limit = hasOwn(listOptions, 'limit')
      ? boundedInteger(listOptions.limit, metadata.items.length || 1, 1, MAX_HISTORY_ITEMS)
      : metadata.items.length
    return metadata.items
      .filter((item) => includeDeleted || item.deletedAt === undefined)
      .filter((item) => !favoritesOnly || item.favorite)
      .slice(0, limit)
      .map(publicItem)
  }

  function get(id, rawOptions = {}) {
    const getOptions = isRecord(rawOptions) ? rawOptions : {}
    const item = ensureReadableItem(id, normalizeBoolean(getOptions.includeDeleted, false))
    if (!item) return null
    const result = publicItem(item)
    if (normalizeBoolean(getOptions.includeImage, false)) {
      result.png = fs.readFileSync(imagePathFor(store, item.id))
    }
    return result
  }

  function readPng(id, rawOptions = {}) {
    const readOptions = isRecord(rawOptions) ? rawOptions : {}
    const item = ensureReadableItem(id, normalizeBoolean(readOptions.includeDeleted, false))
    return item ? fs.readFileSync(imagePathFor(store, item.id)) : null
  }

  function updateItem(id, mutate) {
    const safeId = requireHistoryId(id)
    const existing = metadata.items.find((item) => item.id === safeId)
    if (!existing) return null
    const updated = mutate(cloneItem(existing))
    const retained = retentionResult(
      metadata.items.map((item) => item.id === safeId ? updated : cloneItem(item)),
      limits
    )
    persistRetained(retained.items, retained.discarded)
    const saved = metadata.items.find((item) => item.id === safeId)
    return saved ? publicItem(saved) : null
  }

  function setFavorite(id, favorite) {
    const current = findItem(id, true)
    if (!current) return null
    const nextFavorite = normalizeBoolean(favorite, current.favorite)
    if (nextFavorite === current.favorite) return publicItem(current)
    return updateItem(id, (item) => ({
      ...item,
      favorite: nextFavorite,
      updatedAt: safeNow(clock),
    }))
  }

  function toggleFavorite(id) {
    const current = findItem(id, true)
    return current ? setFavorite(id, !current.favorite) : null
  }

  function deleteItem(id) {
    const current = findItem(id, true)
    if (!current) return null
    if (current.deletedAt !== undefined) return publicItem(current)
    const now = safeNow(clock)
    return updateItem(id, (item) => ({
      ...item,
      deletedAt: now,
      updatedAt: now,
    }))
  }

  function restore(id) {
    const current = findItem(id, true)
    if (!current || current.deletedAt === undefined) return current ? publicItem(current) : null
    if (!lstatRegularFile(imagePathFor(store, current.id), true)) return null
    return updateItem(id, (item) => {
      const restored = { ...item, updatedAt: safeNow(clock) }
      delete restored.deletedAt
      return restored
    })
  }

  function destinationDirectory(directory) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
      throw historyError('HISTORY_INVALID_DESTINATION', '快速保存目录必须是绝对路径')
    }
    const requested = path.resolve(directory)
    fs.mkdirSync(requested, { recursive: true, mode: 0o700 })
    const stat = fs.lstatSync(requested)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw historyError('HISTORY_UNSAFE_PATH', '快速保存目录不安全')
    }
    return typeof fs.realpathSync.native === 'function'
      ? fs.realpathSync.native(requested)
      : fs.realpathSync(requested)
  }

  function outputFilename(value, item) {
    const fallback = 'ttool-screenshot-' + item.createdAt + '-' + item.id + '.png'
    const name = typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.png$/i.test(name)) {
      throw historyError('HISTORY_INVALID_FILENAME', '快速保存文件名非法')
    }
    return name
  }

  function quickSave(id, directory, rawOptions = {}) {
    const saveOptions = isRecord(rawOptions) ? rawOptions : {}
    const item = ensureReadableItem(id, normalizeBoolean(saveOptions.includeDeleted, false))
    if (!item) return null

    const root = destinationDirectory(directory)
    const requestedName = outputFilename(saveOptions.filename, item)
    const extension = path.extname(requestedName)
    const stem = requestedName.slice(0, -extension.length)
    const source = imagePathFor(store, item.id)
    for (let index = 0; index < 1_000; index += 1) {
      const candidateName = index === 0 ? requestedName : stem + '-' + index + extension
      const destination = containedChild(root, candidateName)
      try {
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
        return { id: item.id, path: destination, byteLength: item.byteLength }
      } catch (error) {
        if (error && error.code === 'EEXIST') continue
        throw error
      }
    }
    throw historyError('HISTORY_DESTINATION_COLLISION', '快速保存目标文件冲突过多')
  }

  function stats() {
    const deleted = metadata.items.filter((item) => item.deletedAt !== undefined)
    return {
      count: metadata.items.length,
      activeCount: metadata.items.length - deleted.length,
      deletedCount: deleted.length,
      favoriteCount: metadata.items.filter((item) => item.favorite).length,
      byteLength: metadata.items.reduce((sum, item) => sum + item.byteLength, 0),
      limits: { ...limits },
      malformedMetadata,
    }
  }

  return Object.freeze({
    rootDir: store.rootDir,
    limits: { ...limits },
    addPng,
    create: addPng,
    list,
    get,
    readPng,
    setFavorite,
    toggleFavorite,
    delete: deleteItem,
    restore,
    quickSave,
    stats,
  })
}

module.exports = {
  HISTORY_SCHEMA_VERSION,
  DEFAULT_HISTORY_LIMITS,
  MAX_HISTORY_ITEMS,
  MAX_HISTORY_BYTES,
  safeHistoryId,
  normalizeHistoryLimits,
  createScreenshotHistory,
}
