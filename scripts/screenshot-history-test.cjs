'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  createScreenshotHistory,
  safeHistoryId,
} = require('../electron/screenshot-history.cjs')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function fakePng(byte, payloadLength = 2) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(payloadLength, byte)])
}

function assertErrorCode(run, code) {
  assert.throws(run, (error) => Boolean(error) && error.code === code)
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ttool-screenshot-history-test-'))
let now = 1_000
const clock = () => now++

try {
  const historyRoot = path.join(tempRoot, 'history')
  const history = createScreenshotHistory({
    rootDir: historyRoot,
    limits: { maxItems: 4, maxBytes: 100 },
    now: clock,
  })

  const first = history.addPng(fakePng(1), {
    id: 'shot_first',
    width: 12,
    height: 8,
    displayId: 9,
    source: 'overlay',
    favorite: true,
  })
  assert.equal(first.favorite, true)
  assert.equal(first.byteLength, 10)
  assert.equal(history.get('shot_first').width, 12)
  assert.deepEqual(history.get('shot_first', { includeImage: true }).png, fakePng(1))

  // 新实例必须从同一 metadata 和图片文件恢复，而不是依赖进程内状态。
  const restarted = createScreenshotHistory({
    rootDir: historyRoot,
    limits: { maxItems: 4, maxBytes: 100 },
    now: clock,
  })
  assert.equal(restarted.list().length, 1)
  assert.equal(restarted.list()[0].id, 'shot_first')
  assert.equal(restarted.stats().favoriteCount, 1)
  assert.equal(restarted.setFavorite('shot_first', false).favorite, false)
  assert.equal(restarted.toggleFavorite('shot_first').favorite, true)

  const deleted = restarted.delete('shot_first')
  assert.ok(deleted.deletedAt !== undefined)
  assert.deepEqual(restarted.list(), [])
  assert.equal(restarted.get('shot_first'), null)
  assert.equal(restarted.get('shot_first', { includeDeleted: true }).id, 'shot_first')
  assert.equal(restarted.restore('shot_first').deletedAt, undefined)
  assert.equal(restarted.list().length, 1)

  const quickSaveDirectory = path.join(tempRoot, 'quick-save')
  const saved = restarted.quickSave('shot_first', quickSaveDirectory, { filename: 'capture.png' })
  assert.equal(saved.id, 'shot_first')
  assert.deepEqual(fs.readFileSync(saved.path), fakePng(1))
  const savedAgain = restarted.quickSave('shot_first', quickSaveDirectory, { filename: 'capture.png' })
  assert.equal(path.basename(savedAgain.path), 'capture-1.png')

  // 损坏 metadata 不能崩溃，也不会在第一次读取时静默覆盖原始证据。
  const malformedRoot = path.join(tempRoot, 'malformed')
  fs.mkdirSync(malformedRoot, { recursive: true })
  fs.writeFileSync(path.join(malformedRoot, 'metadata.json'), '{"schemaVersion":')
  const malformed = createScreenshotHistory({
    rootDir: malformedRoot,
    limits: { maxItems: 2, maxBytes: 40 },
    now: clock,
  })
  assert.deepEqual(malformed.list(), [])
  assert.equal(malformed.stats().malformedMetadata, true)
  malformed.addPng(fakePng(2), { id: 'shot_recovered' })
  assert.equal(malformed.stats().malformedMetadata, false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(malformedRoot, 'metadata.json'), 'utf8')).schemaVersion, 1)
  assert.ok(fs.readdirSync(malformedRoot).some((name) => name.startsWith('metadata.corrupt-')))

  // 所有由调用方给出的 id/文件名都先校验，无法借由历史目录写出根目录。
  assert.equal(safeHistoryId('../escape'), null)
  assert.equal(safeHistoryId('ok_id-1'), 'ok_id-1')
  assertErrorCode(() => restarted.get('../escape'), 'HISTORY_INVALID_ID')
  assertErrorCode(() => restarted.addPng(fakePng(3), { id: '..\\escape' }), 'HISTORY_INVALID_ID')
  assertErrorCode(
    () => restarted.quickSave('shot_first', quickSaveDirectory, { filename: '../escape.png' }),
    'HISTORY_INVALID_FILENAME'
  )
  assert.equal(fs.existsSync(path.join(tempRoot, 'escape.png')), false)

  // 上限按删除项、普通项、收藏项的稳定顺序回收；收藏优先保留，但硬字节上限始终成立。
  const retentionRoot = path.join(tempRoot, 'retention')
  const retention = createScreenshotHistory({
    rootDir: retentionRoot,
    limits: { maxItems: 2, maxBytes: 20 },
    now: clock,
  })
  retention.addPng(fakePng(10), { id: 'shot_old', createdAt: 10 })
  retention.addPng(fakePng(11), { id: 'shot_favorite', createdAt: 20, favorite: true })
  retention.addPng(fakePng(12), { id: 'shot_new', createdAt: 30 })
  assert.deepEqual(retention.list().map((item) => item.id), ['shot_new', 'shot_favorite'])
  assert.equal(fs.existsSync(path.join(retentionRoot, 'images', 'shot_old.png')), false)
  assert.equal(retention.stats().byteLength, 20)
  assertErrorCode(
    () => retention.addPng(fakePng(13, 13), { id: 'shot_too_large' }),
    'HISTORY_IMAGE_TOO_LARGE'
  )

  const metadata = JSON.parse(fs.readFileSync(path.join(retentionRoot, 'metadata.json'), 'utf8'))
  assert.equal(metadata.schemaVersion, 1)
  assert.equal(metadata.items.length, 2)
  assert.equal(
    fs.readdirSync(retentionRoot).concat(fs.readdirSync(path.join(retentionRoot, 'images'))).some((name) => name.endsWith('.tmp')),
    false
  )

  console.log('screenshot history tests passed')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  assert.equal(fs.existsSync(tempRoot), false, '测试临时目录必须清理')
}
