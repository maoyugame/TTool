// platform.db.redis 适配器（ioredis，RESP2）。语义见 HOST-DB-SPEC.md §5。
// 二进制值用 opts.binary=true 走 callBuffer 返回 Uint8Array，避免 UTF-8 破坏。
const Redis = require('ioredis')
const { doConnect, withConn, MAX_TOTAL_BYTES, MAX_VALUE_BYTES } = require('./dbutil.cjs')
const { redact } = require('./util.cjs')

const TOO_BIG = Symbol('TOO_BIG')

// 归一化 reply：Buffer→Uint8Array（递归），string/number/null 原样；累计/单值字节封顶。
function normReply(r, budget) {
  if (r == null) return null
  if (Buffer.isBuffer(r)) {
    if (r.byteLength > MAX_VALUE_BYTES) throw TOO_BIG
    budget.n += r.byteLength
    if (budget.n > MAX_TOTAL_BYTES) throw TOO_BIG
    return new Uint8Array(r)
  }
  if (typeof r === 'string') {
    budget.n += Buffer.byteLength(r)
    if (budget.n > MAX_TOTAL_BYTES) throw TOO_BIG
    return r
  }
  if (Array.isArray(r)) return r.map((x) => normReply(x, budget))
  if (r instanceof Error) return { _t: 'error', message: redact(String((r && r.message) || r)) } // 数组内嵌 ReplyError（如 EXEC 部分失败）归一
  if (typeof r === 'number' || typeof r === 'boolean') return r
  return String(r) // 兜底：未知类型转字符串，避免不可克隆对象进 IPC
}

function toArgs(args) {
  return args.map((x) => (x instanceof Uint8Array ? Buffer.from(x) : x))
}

function setupRedis({ ipcMain, registry }) {
  ipcMain.handle('db:redis:connect', async (_e, config = {}) => {
    const c = config || {}
    if (!c.host) return { ok: false, code: 'BAD_ARGS', error: '缺少 host' }
    return doConnect({
      registry,
      kind: 'redis',
      pluginId: c.pluginId,
      connectFn: async () => {
        const r = new Redis({
          host: c.host,
          port: c.port || 6379,
          username: c.username,
          password: c.password,
          db: c.db || 0,
          tls: c.tls === true ? {} : c.tls && typeof c.tls === 'object' ? c.tls : undefined,
          connectTimeout: c.connectTimeoutMs || 10000,
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          retryStrategy: () => null, // 不自动重连，连不上即失败（工具语义）
        })
        // 记录底层错误（ECONNREFUSED/ENOTFOUND/WRONGPASS 等）并防 ioredis 未捕获 error 事件崩进程。
        // retryStrategy:()=>null 下 connect() 的 reject 常为通用 'Connection is closed.'，真实错误在 error 事件上。
        let lastErr
        r.on('error', (e) => { lastErr = e })
        try {
          await r.connect()
        } catch (err) {
          try { r.disconnect() } catch { /* ignore */ }
          throw lastErr || err // 优先用底层真实错误，使 mapDbError 能归类 CONN_REFUSED/DNS_FAIL/AUTH_FAILED
        }
        return r
      },
      teardownFn: (r) => (r.quit ? r.quit().catch(() => r.disconnect()) : r.disconnect()),
      serverVersionFn: async (r) => {
        const info = await r.info('server')
        const m = /redis_version:([^\r\n]+)/.exec(info)
        return m && m[1]
      },
    })
  })

  ipcMain.handle('db:redis:command', async (_e, { connId, args, opts } = {}) => {
    if (!Array.isArray(args) || args.length === 0 || typeof args[0] !== 'string') {
      return { ok: false, code: 'BAD_ARGS', error: 'args 非空且 args[0] 须为命令名字符串' }
    }
    return withConn(registry, connId, async (redis) => {
      const a = toArgs(args)
      const fn = opts && opts.binary ? 'callBuffer' : 'call'
      const raw = await redis[fn](a[0], ...a.slice(1))
      try {
        return { ok: true, reply: normReply(raw, { n: 0 }) }
      } catch (e) {
        if (e === TOO_BIG) return { ok: false, code: 'RESULT_TRUNCATED', error: '返回值过大，请缩小范围（如 SCAN/分片/避免 KEYS *）' }
        throw e
      }
    })
  })

  ipcMain.handle('db:redis:pipeline', async (_e, { connId, cmds } = {}) => {
    if (!Array.isArray(cmds) || cmds.length === 0) return { ok: false, code: 'BAD_ARGS', error: 'cmds 非空' }
    return withConn(registry, connId, async (redis) => {
      // 先全量校验再排队，确保「要么全排要么全不排」（BAD_ARGS 时未执行任何命令）
      const prepared = []
      for (const spec of cmds) {
        const a = toArgs((spec && spec.args) || [])
        if (a.length === 0 || typeof a[0] !== 'string') return { ok: false, code: 'BAD_ARGS', error: '每条 cmd 的 args[0] 须为命令名' }
        prepared.push({ a, binary: !!(spec && spec.binary) })
      }
      const p = redis.pipeline()
      for (const { a, binary } of prepared) p[binary ? 'callBuffer' : 'call'](a[0], ...a.slice(1))
      const res = await p.exec() // [[err, result], ...]
      const budget = { n: 0 }
      try {
        const replies = (res || []).map(([err, result]) =>
          err ? { _t: 'error', message: redact(String((err && err.message) || err)) } : normReply(result, budget)
        )
        return { ok: true, replies }
      } catch (e) {
        if (e === TOO_BIG) return { ok: false, code: 'RESULT_TRUNCATED', error: 'pipeline 返回值过大' }
        throw e
      }
    })
  })

  ipcMain.handle('db:redis:close', async (_e, { connId } = {}) => {
    registry.remove(connId)
    return { ok: true }
  })

  ipcMain.handle('db:redis:ping', async (_e, { connId } = {}) =>
    withConn(registry, connId, async (redis) => {
      await redis.ping()
      return { ok: true }
    })
  )
}

module.exports = { setupRedis }
