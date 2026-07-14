// Codex App Server 用量客户端：仅运行在 Electron 主进程。
// 不读取、不透传任何认证令牌；App Server 自行使用用户已登录的本机 Codex 会话。
const { spawn } = require('node:child_process')

const DEFAULT_POLL_INTERVAL_MS = 60_000
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

function emptyState() {
  return {
    connection: 'idle',
    error: null,
    updatedAt: null,
    rateLimits: null,
    usage: null,
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function mergeWindow(previous, next) {
  if (!previous) return next || null
  if (!next) return previous
  return { ...previous, ...next }
}

function mergeRateLimitSnapshot(previous, next) {
  if (!previous) return next || null
  if (!next) return previous
  return {
    ...previous,
    ...next,
    primary: mergeWindow(previous.primary, next.primary),
    secondary: mergeWindow(previous.secondary, next.secondary),
    credits: previous.credits || next.credits ? { ...previous.credits, ...next.credits } : null,
    individualLimit: previous.individualLimit || next.individualLimit ? { ...previous.individualLimit, ...next.individualLimit } : null,
  }
}

function codexCommand() {
  // Windows 下优先 .exe，避免 Node 直接启动 .cmd shim 的 EINVAL 限制。
  return process.platform === 'win32' ? 'codex.exe' : 'codex'
}

function createCodexUsageService({ spawnImpl = spawn, onState = () => {}, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  let child = null
  let childOutput = ''
  let initialized = false
  let nextRequestId = 1
  let stoppedByOwner = false
  let sessionId = 0
  let pollTimer = null
  const pendingRequests = new Map()
  let current = emptyState()

  function publish() {
    onState(clone(current))
  }

  function update(next) {
    current = { ...current, ...next, updatedAt: Date.now() }
    publish()
  }

  function clearPendingRequests() {
    for (const item of pendingRequests.values()) clearTimeout(item.timer)
    pendingRequests.clear()
  }

  function clearPolling() {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
  }

  function markUnavailable(message) {
    current = {
      ...current,
      connection: 'error',
      error: message,
      updatedAt: Date.now(),
    }
    publish()
  }

  function sendNotification(method, params) {
    if (!child || !child.stdin || child.stdin.destroyed) return false
    try {
      child.stdin.write(JSON.stringify({ method, params }) + '\n')
      return true
    } catch {
      markUnavailable('无法与本机 Codex 通信')
      return false
    }
  }

  function request(method, params = {}) {
    if (!child || !child.stdin || child.stdin.destroyed) return null
    const id = nextRequestId++
    const timer = setTimeout(() => {
      if (!pendingRequests.has(id)) return
      pendingRequests.delete(id)
      markUnavailable('本机 Codex 响应超时')
    }, requestTimeoutMs)
    pendingRequests.set(id, { method, timer })
    try {
      child.stdin.write(JSON.stringify({ method, id, params }) + '\n')
      return id
    } catch {
      clearTimeout(timer)
      pendingRequests.delete(id)
      markUnavailable('无法与本机 Codex 通信')
      return null
    }
  }

  function beginPolling() {
    clearPolling()
    pollTimer = setInterval(() => refresh(), pollIntervalMs)
  }

  function handleRateLimitUpdate(patch) {
    const existing = current.rateLimits || {}
    const mergedPrimary = mergeRateLimitSnapshot(existing.rateLimits, patch)
    update({
      connection: 'ready',
      error: null,
      rateLimits: { ...existing, rateLimits: mergedPrimary },
    })
  }

  function handleResponse(message) {
    const pending = pendingRequests.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingRequests.delete(message.id)

    if (message.error) {
      if (pending.method === 'account/rateLimits/read' || pending.method === 'account/usage/read') {
        markUnavailable('无法读取 Codex 用量，请确认已在本机 Codex 登录')
      } else {
        markUnavailable('本机 Codex 初始化失败')
      }
      return
    }

    if (pending.method === 'initialize') {
      initialized = true
      sendNotification('initialized', {})
      update({ connection: 'ready', error: null })
      request('account/rateLimits/read')
      request('account/usage/read')
      beginPolling()
      return
    }

    if (pending.method === 'account/rateLimits/read') {
      update({ connection: 'ready', error: null, rateLimits: message.result || null })
      return
    }

    if (pending.method === 'account/usage/read') {
      update({ connection: 'ready', error: null, usage: message.result || null })
    }
  }

  function handleMessage(message) {
    if (!message || typeof message !== 'object') return
    if (typeof message.id === 'number') {
      handleResponse(message)
      return
    }
    if (message.method === 'account/rateLimits/updated') {
      handleRateLimitUpdate(message.params && message.params.rateLimits)
      return
    }
    // 若 App Server 请求令牌刷新，绝不从 TTool 收集或返回凭据。
    if (message.method === 'account/chatgptAuthTokens/refresh') {
      markUnavailable('本机 Codex 需要先完成登录')
    }
  }

  function consumeOutput(chunk) {
    childOutput += String(chunk || '')
    let end = childOutput.indexOf('\n')
    while (end >= 0) {
      const line = childOutput.slice(0, end).trim()
      childOutput = childOutput.slice(end + 1)
      if (line) {
        try {
          handleMessage(JSON.parse(line))
        } catch {
          // 忽略 App Server 的非 JSON 日志行，避免把潜在敏感内容发送给渲染层。
        }
      }
      end = childOutput.indexOf('\n')
    }
  }

  function start() {
    if (child) return state()
    stoppedByOwner = false
    initialized = false
    childOutput = ''
    const activeSessionId = ++sessionId
    update({ connection: 'connecting', error: null })
    try {
      child = spawnImpl(codexCommand(), ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch {
      child = null
      markUnavailable('未找到可用的本机 Codex CLI')
      return state()
    }

    if (!child) {
      markUnavailable('未找到可用的本机 Codex CLI')
      return state()
    }
    const launchedChild = child
    child.stdout?.setEncoding?.('utf8')
    child.stdout?.on('data', consumeOutput)
    child.on?.('error', () => {
      if (child !== launchedChild || sessionId !== activeSessionId) return
      child = null
      clearPendingRequests()
      clearPolling()
      if (!stoppedByOwner) markUnavailable('无法启动本机 Codex CLI')
    })
    child.on?.('exit', () => {
      if (child !== launchedChild || sessionId !== activeSessionId) return
      child = null
      clearPendingRequests()
      clearPolling()
      if (!stoppedByOwner) markUnavailable('本机 Codex 已停止')
    })
    request('initialize', {
      clientInfo: {
        name: 'ttool',
        title: 'TTool Codex Usage Widget',
        version: '0.2.0',
      },
    })
    return state()
  }

  function refresh() {
    if (!child) return start()
    if (!initialized) return state()
    request('account/rateLimits/read')
    request('account/usage/read')
    return state()
  }

  function stop() {
    stoppedByOwner = true
    sessionId += 1
    clearPendingRequests()
    clearPolling()
    const active = child
    child = null
    initialized = false
    if (active) {
      try {
        active.stdin?.end?.()
      } catch {
        /* ignore */
      }
      try {
        active.kill?.()
      } catch {
        /* ignore */
      }
    }
    current = emptyState()
    publish()
    return state()
  }

  function state() {
    return clone(current)
  }

  return { start, stop, refresh, state, handleMessage }
}

module.exports = { createCodexUsageService, mergeRateLimitSnapshot }
