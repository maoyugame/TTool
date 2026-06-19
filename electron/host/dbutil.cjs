// DB 适配器共享工具：连接建立预占/落地、忙碌管理、错误码归一、计时、结果体量封顶。
const { redact } = require('./util.cjs')

const MAX_ROWS_HARD = 50000
const MAX_TOTAL_BYTES = 16 * 1024 * 1024 // 累计返回字节上限（含首行，超过即截断/拒绝）
const MAX_VALUE_BYTES = 16 * 1024 * 1024 // 单值硬上限（与总上限一致；超过则拒绝整条结果）

// connect 通用流程：reserve 预占 → 异步建连 → 落地前校验预占有效（防 reload 孤儿）→ add + release。
// connectFn() 返回真实驱动连接对象；teardownFn(conn) 负责销毁。失败/超时/作废分支统一释放预占。
async function doConnect({ registry, kind, pluginId, connectFn, teardownFn, serverVersionFn }) {
  const pid = pluginId || '__anon__'
  const token = registry.reserve(pid)
  if (!token) return { ok: false, code: 'TOO_MANY_CONNS', error: '连接数已达上限' }
  let conn
  try {
    conn = await connectFn()
  } catch (err) {
    registry.release(token)
    return mapDbError(err)
  }
  // 建连期间若发生 owner 清理（如整页 reload），预占已失效：销毁连接、不登记。
  if (!registry.isReserved(token)) {
    try { await teardownFn(conn) } catch { /* ignore */ }
    registry.release(token)
    return { ok: false, code: 'STALE_CONN', error: '连接在建立期间被回收' }
  }
  const id = registry.add(kind, conn, pid, async (e) => { try { await teardownFn(e.conn) } catch { /* ignore */ } }, { idleEvictable: true })
  registry.release(token)
  let serverVersion
  if (serverVersionFn) { try { serverVersion = await serverVersionFn(conn) } catch { /* 非关键 */ } }
  return { ok: true, connId: id, serverVersion }
}

// 忙碌管理：op 期间 inflight++（防 idle 回收正在用的连接），结束 inflight-- 并刷新 lastUsedAt。
async function withConn(registry, connId, fn) {
  const e = registry.get(connId)
  if (!e) return { ok: false, code: 'NO_CONN', error: '连接不存在或已关闭（可能被回收，请重连）' }
  e._inflight = (e._inflight || 0) + 1
  e.busy = true
  registry.touch(e)
  const t0 = Date.now()
  try {
    const r = await fn(e.conn)
    if (r && typeof r === 'object' && r.ok && r.durationMs === undefined) r.durationMs = Date.now() - t0
    return r
  } catch (err) {
    return { ...mapDbError(err), durationMs: Date.now() - t0 }
  } finally {
    e._inflight = Math.max(0, (e._inflight || 1) - 1)
    if (e._inflight === 0) e.busy = false
    registry.touch(e)
  }
}

// 驱动错误 → 统一上层 code（保留 driverCode/errno 供高级展示；message 脱敏）。
function mapDbError(err) {
  const rawCode = err && err.code
  const code = typeof rawCode === 'string' ? rawCode : undefined
  const numCode = typeof (err && err.code) === 'number' ? err.code : err && err.codeName
  const name = err && err.name
  const msg = String((err && err.message) || err || '')
  const hay = (code || '') + ' ' + (name || '') + ' ' + msg
  let c = 'UNKNOWN'
  if (/ER_ACCESS_DENIED|WRONGPASS|NOAUTH|AuthenticationFailed|access denied|authentication failed|bad auth/i.test(hay) || numCode === 18) c = 'AUTH_FAILED'
  else if (/ECONNREFUSED|connection refused/i.test(hay)) c = 'CONN_REFUSED'
  else if (/ETIMEDOUT|ETIME|timeout|ServerSelectionError|PROTOCOL_SEQUENCE_TIMEOUT/i.test(hay)) c = 'TIMEOUT'
  else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(hay)) c = 'DNS_FAIL'
  else if (/CERT|TLS|SSL|self.signed|self-signed|altname/i.test(hay)) c = 'TLS_FAIL'
  else if (/ER_DUP_ENTRY|E11000|duplicate key/i.test(hay) || numCode === 11000) c = 'DUP_KEY'
  else if (/ER_PARSE_ERROR|syntax|ER_BAD_FIELD|ER_NO_SUCH_TABLE/i.test(hay)) c = 'SYNTAX_ERR'
  const out = { ok: false, code: c, error: redact(msg) }
  if (code) out.driverCode = code
  else if (err && err.codeName) out.driverCode = String(err.codeName)
  if (err && typeof err.errno === 'number') out.errno = err.errno
  else if (typeof (err && err.code) === 'number') out.errno = err.code
  return out
}

const bytesOf = (v) => {
  if (v == null) return 0
  if (typeof v === 'string') return Buffer.byteLength(v)
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) return v.byteLength
  if (typeof v === 'number') return 8
  try { return Buffer.byteLength(JSON.stringify(v)) } catch { return 64 }
}

// 深转 Buffer→Uint8Array（IPC 安全 + 显式 BLOB→Uint8Array），并估算字节。返回 {value, bytes, tooBig}。
function normalizeValue(v) {
  if (Buffer.isBuffer(v)) {
    if (v.byteLength > MAX_VALUE_BYTES) return { value: null, bytes: v.byteLength, tooBig: true }
    return { value: new Uint8Array(v), bytes: v.byteLength }
  }
  if (v instanceof Uint8Array) {
    if (v.byteLength > MAX_VALUE_BYTES) return { value: null, bytes: v.byteLength, tooBig: true }
    return { value: v, bytes: v.byteLength }
  }
  if (typeof v === 'string' && Buffer.byteLength(v) > MAX_VALUE_BYTES) return { value: null, bytes: Buffer.byteLength(v), tooBig: true }
  return { value: v, bytes: bytesOf(v) }
}

// 行/文档结果归一：限行数（min(maxRows, 硬上限)）+ 累计字节封顶 + Buffer→Uint8Array。
// 返回 { rows, truncated } 或 { error:'TOO_BIG' }（单值超硬上限）。
function truncateRows(rows, maxRows) {
  const cap = Math.min(Math.max(1, maxRows || 5000), MAX_ROWS_HARD)
  const out = []
  let total = 0
  let truncated = false
  for (let i = 0; i < rows.length; i++) {
    if (out.length >= cap) { truncated = true; break }
    const row = rows[i]
    let normalized = row
    let rowBytes = 0
    if (row && typeof row === 'object') {
      const isArr = Array.isArray(row)
      normalized = isArr ? [] : {}
      for (const k of Object.keys(row)) {
        const nv = normalizeValue(row[k])
        if (nv.tooBig) return { error: 'TOO_BIG' }
        normalized[k] = nv.value
        rowBytes += nv.bytes + (isArr ? 0 : Buffer.byteLength(k))
      }
    } else {
      const nv = normalizeValue(row)
      if (nv.tooBig) return { error: 'TOO_BIG' }
      normalized = nv.value
      rowBytes = nv.bytes
    }
    if (total + rowBytes > MAX_TOTAL_BYTES) {
      if (out.length === 0) return { error: 'TOO_BIG' } // 首行即超总上限：拒绝（RESULT_TRUNCATED），避免超 IPC 上限
      truncated = true
      break
    }
    out.push(normalized)
    total += rowBytes
  }
  return { rows: out, truncated }
}

module.exports = { doConnect, withConn, mapDbError, truncateRows, normalizeValue, bytesOf, MAX_ROWS_HARD, MAX_TOTAL_BYTES, MAX_VALUE_BYTES }
