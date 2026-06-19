// platform.net：通用 TCP/TLS 字节管道（底座）。
// 渲染层沙箱拿不到原始 socket；主进程用 node net/tls 建连并按 socketId 多路复用，
// data/close/error/drain 经 IPC 推回渲染层。任意 TCP 协议插件直接用它，不需改 SDK。
//
// 复用 registry 的生命周期（owner 清理 / idle / 上限）。
const net = require('node:net')
const tls = require('node:tls')
const { redact, safePluginId } = require('./util.cjs')

// 驱动错误码 → 统一上层 code。
function mapErr(err) {
  const code = err && err.code
  const msg = String((err && err.message) || err || '')
  let c = 'UNKNOWN'
  if (code === 'ECONNREFUSED') c = 'CONN_REFUSED'
  else if (code === 'ETIMEDOUT' || code === 'ETIME') c = 'TIMEOUT'
  else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') c = 'DNS_FAIL'
  else if (/CERT|TLS|SSL|altname|self.signed/i.test(code + ' ' + msg)) c = 'TLS_FAIL'
  return { ok: false, code: c, driverCode: code, error: redact(msg) }
}

function setupNet({ ipcMain, registry, getSender }) {
  function send(channel, payload) {
    const wc = getSender()
    if (wc && !wc.isDestroyed()) {
      try { wc.send(channel, payload) } catch { /* 窗口已销毁忽略 */ }
    }
  }

  ipcMain.handle('net:connect', (_e, opts) => {
    const o = opts || {}
    // 先做无副作用的参数校验（不占名额），再预占连接槽——错误码更贴合真实原因。
    const host = String(o.host || '')
    const port = Number(o.port)
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return Promise.resolve({ ok: false, code: 'BAD_ARGS', error: 'host/port 非法' })
    }
    // pluginId 归一：非法 / 空串归入保留桶，避免稀释 per-plugin 计数。
    const pluginId = safePluginId(o.pluginId) || '__anon__'
    // 预占名额（与上限判定同步原子），堵住并发 connect 击穿上限的 TOCTOU。
    const token = registry.reserve(pluginId)
    if (!token) return Promise.resolve({ ok: false, code: 'TOO_MANY_CONNS', error: '连接数已达上限' })

    return new Promise((resolve) => {
      let done = false
      let timer = null
      let socket = null
      const finish = (r) => {
        if (done) return
        done = true
        if (timer) clearTimeout(timer)
        if (!r.ok) registry.release(token) // 失败分支释放预占；成功分支已在 onConnect 中释放
        resolve(r)
      }
      const preErr = (err) => finish(mapErr(err))
      function onConnect() {
        if (socket) socket.removeListener('error', preErr)
        // 预占已被 owner 清理作废（如握手期间整页 reload）：丢弃这条孤儿连接，不登记、不推数据。
        if (!registry.isReserved(token)) {
          try { socket.destroy() } catch { /* ignore */ }
          finish({ ok: false, code: 'STALE_CONN', error: '连接在建立期间被回收' })
          return
        }
        // net 持久连接不参与 idle 回收（idleEvictable:false）
        const id = registry.add('net', socket, pluginId, (e) => { try { e.conn.destroy() } catch { /* ignore */ } }, { idleEvictable: false })
        registry.release(token) // 预占转为正式条目
        socket.on('data', (buf) => {
          const e = registry.get(id)
          if (e) registry.touch(e)
          send('net:data:' + id, new Uint8Array(buf)) // 复制成独立 Uint8Array，脱离 Buffer 池
        })
        socket.on('drain', () => send('net:drain:' + id))
        socket.on('close', (hadError) => {
          registry.remove(id)
          // 主动 close 的回声不再下发（避免插件无法区分"自己关的"与"对端关的"）
          if (!socket.__selfClosing) send('net:close:' + id, { hadError: !!hadError })
        })
        socket.on('error', (err) => send('net:error:' + id, { error: redact(String((err && err.message) || err)), code: err && err.code }))
        finish({ ok: true, socketId: id })
      }

      try {
        if (o.tls) {
          const t = o.tls === true ? {} : o.tls
          socket = tls.connect({ host, port, servername: t.servername || host, rejectUnauthorized: t.rejectUnauthorized !== false }, onConnect)
        } else {
          socket = net.connect({ host, port }, onConnect)
        }
      } catch (err) {
        finish(mapErr(err))
        return
      }
      socket.once('error', preErr)
      timer = setTimeout(() => {
        try { socket.destroy() } catch { /* ignore */ }
        finish({ ok: false, code: 'TIMEOUT', error: '连接超时' })
      }, Number(o.timeoutMs) || 10000)
    })
  })

  ipcMain.handle('net:write', (_e, payload) => {
    const { socketId, data } = payload || {}
    const e = registry.get(socketId)
    if (!e) return { ok: false, code: 'NO_CONN', error: '连接不存在或已关闭' }
    registry.touch(e)
    try {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data || [])
      const drained = e.conn.write(buf)
      return { ok: true, backpressure: !drained } // backpressure 时插件应等 onDrain 再续写
    } catch (err) {
      return { ok: false, code: 'UNKNOWN', error: redact(String((err && err.message) || err)) }
    }
  })

  ipcMain.handle('net:close', (_e, payload) => {
    const { socketId } = payload || {}
    const e = registry.get(socketId)
    if (e && e.conn) e.conn.__selfClosing = true // 标记主动关闭，'close' 事件不再回声
    registry.remove(socketId)
    return { ok: true }
  })
}

module.exports = { setupNet }
