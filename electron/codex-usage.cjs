// Codex App Server 用量客户端：仅运行在 Electron 主进程。
// 不读取、不透传任何认证令牌；App Server 自行使用用户已登录的本机 Codex 会话。
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const DEFAULT_POLL_INTERVAL_MS = 60_000
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

function emptyState() {
  return {
    connection: 'idle',
    error: null,
    updatedAt: null,
    lastSuccessfulRefreshAt: null,
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

function findCommandOnWindowsPath(name, { env = process.env, existsSync = fs.existsSync } = {}) {
  const pathValue = env.Path || env.PATH || ''
  for (const entry of pathValue.split(';')) {
    const directory = entry.trim().replace(/^"|"$/g, '')
    if (!directory) continue
    const candidate = path.join(directory, name)
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // A bad PATH entry must not block the remaining command lookup.
    }
  }
  return null
}

function resolveCodexLaunchAttempts({ platform = process.platform, env = process.env, existsSync = fs.existsSync } = {}) {
  if (platform !== 'win32') return [{ command: 'codex', args: ['app-server'], options: {} }]

  const exePath = findCommandOnWindowsPath('codex.exe', { env, existsSync })
  const cmdPath = findCommandOnWindowsPath('codex.cmd', { env, existsSync })
  const pathKey = Object.prototype.hasOwnProperty.call(env, 'Path') ? 'Path' : 'PATH'
  const commandEnv = cmdPath
    ? { ...env, [pathKey]: path.dirname(cmdPath) + ';' + (env[pathKey] || env.PATH || env.Path || '') }
    : env

  return [
    { command: exePath || 'codex.exe', args: ['app-server'], options: {} },
    {
      command: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', 'codex.cmd app-server'],
      options: { env: commandEnv },
    },
  ]
}

function createCodexUsageService({
  spawnImpl = spawn,
  onState = () => {},
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  platform = process.platform,
  env = process.env,
  existsSync = fs.existsSync,
  clientVersion = '0.0.0',
} = {}) {
  const normalizedClientVersion = typeof clientVersion === 'string' && clientVersion.trim()
    ? clientVersion.trim()
    : '0.0.0'
  let child = null
  let childOutput = ''
  let initialized = false
  let nextRequestId = 1
  let stoppedByOwner = false
  let sessionId = 0
  let pollTimer = null
  let startNextAttempt = null
  const pendingRequests = new Map()
  const readyWaiters = new Set()
  let current = emptyState()

  function publish() {
    onState(clone(current))
  }

  function update(next) {
    current = { ...current, ...next, updatedAt: Date.now() }
    publish()
  }

  function requestError(message) {
    return new Error(message)
  }

  function clearPendingRequests(message = '本机 Codex 已停止') {
    for (const item of pendingRequests.values()) {
      clearTimeout(item.timer)
      item.reject(requestError(message))
    }
    pendingRequests.clear()
  }

  function resolveReadyWaiters() {
    for (const waiter of readyWaiters) waiter.resolve()
    readyWaiters.clear()
  }

  function rejectReadyWaiters(message) {
    for (const waiter of readyWaiters) waiter.reject(requestError(message))
    readyWaiters.clear()
  }

  function waitForInitialization() {
    if (initialized) return Promise.resolve()
    if (current.connection === 'error') return Promise.reject(requestError(current.error || '无法连接本机 Codex'))
    return new Promise((resolve, reject) => readyWaiters.add({ resolve, reject }))
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
    if (!initialized) rejectReadyWaiters(message)
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
    if (!child || !child.stdin || child.stdin.destroyed) return Promise.reject(requestError('无法与本机 Codex 通信'))
    const id = nextRequestId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = pendingRequests.get(id)
        if (!pending) return
        pendingRequests.delete(id)
        const error = requestError('本机 Codex 响应超时')
        pending.reject(error)
        if (method === 'initialize' && !initialized && startNextAttempt) {
          const active = child
          child = null
          try {
            active?.kill?.()
          } catch {
            /* ignore */
          }
          startNextAttempt()
          return
        }
        markUnavailable(error.message)
      }, requestTimeoutMs)
      pendingRequests.set(id, { method, timer, resolve, reject })
      try {
        child.stdin.write(JSON.stringify({ method, id, params }) + '\n')
      } catch {
        clearTimeout(timer)
        pendingRequests.delete(id)
        const error = requestError('无法与本机 Codex 通信')
        reject(error)
        markUnavailable(error.message)
      }
    })
  }

  function beginPolling() {
    clearPolling()
    pollTimer = setInterval(() => { void refresh() }, pollIntervalMs)
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
      let error
      if (pending.method === 'account/rateLimits/read' || pending.method === 'account/usage/read') {
        error = requestError('无法读取 Codex 用量，请确认已在本机 Codex 登录')
      } else {
        error = requestError('本机 Codex 初始化失败')
      }
      markUnavailable(error.message)
      pending.reject(error)
      return
    }

    if (pending.method === 'initialize') {
      initialized = true
      startNextAttempt = null
      sendNotification('initialized', {})
      update({ connection: 'ready', error: null })
      resolveReadyWaiters()
      void request('account/rateLimits/read').catch(() => {})
      void request('account/usage/read').catch(() => {})
      beginPolling()
      pending.resolve(message.result)
      return
    }

    if (pending.method === 'account/rateLimits/read') {
      update({
        connection: 'ready',
        error: null,
        lastSuccessfulRefreshAt: Date.now(),
        rateLimits: message.result || null,
      })
      pending.resolve(message.result)
      return
    }

    if (pending.method === 'account/usage/read') {
      update({
        connection: 'ready',
        error: null,
        lastSuccessfulRefreshAt: Date.now(),
        usage: message.result || null,
      })
      pending.resolve(message.result)
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
    const attempts = resolveCodexLaunchAttempts({ platform, env, existsSync })
    let attemptIndex = 0

    startNextAttempt = () => {
      const attempt = attempts[attemptIndex++]
      if (!attempt) {
        startNextAttempt = null
        if (!stoppedByOwner) markUnavailable('\u672a\u627e\u5230\u53ef\u7528\u7684\u672c\u673a Codex CLI')
        return false
      }

      let launchedChild
      try {
        launchedChild = spawnImpl(attempt.command, attempt.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          ...attempt.options,
        })
      } catch {
        return startNextAttempt()
      }

      if (!launchedChild) return startNextAttempt()
      child = launchedChild
      launchedChild.stdout?.setEncoding?.('utf8')
      launchedChild.stdout?.on('data', consumeOutput)
      launchedChild.on?.('error', () => {
        if (child !== launchedChild || sessionId !== activeSessionId) return
        child = null
        clearPendingRequests()
        clearPolling()
        if (!stoppedByOwner && !initialized && startNextAttempt) {
          startNextAttempt()
          return
        }
        if (!stoppedByOwner) markUnavailable('\u65e0\u6cd5\u542f\u52a8\u672c\u673a Codex CLI')
      })
      launchedChild.on?.('exit', () => {
        if (child !== launchedChild || sessionId !== activeSessionId) return
        child = null
        clearPendingRequests()
        clearPolling()
        if (!stoppedByOwner && !initialized && startNextAttempt) {
          startNextAttempt()
          return
        }
        if (!stoppedByOwner) markUnavailable('\u672c\u673a Codex \u5df2\u505c\u6b62')
      })
      void request('initialize', {
        clientInfo: {
          name: 'ttool',
          title: 'TTool Codex Usage Widget',
          version: normalizedClientVersion,
        },
      }).catch(() => {})
      return true
    }
    startNextAttempt()
    return state()
  }

  async function refresh() {
    if (!child) start()
    try {
      if (!initialized) await waitForInitialization()
      await Promise.all([
        request('account/rateLimits/read'),
        request('account/usage/read'),
      ])
    } catch (error) {
      if (current.connection !== 'error') markUnavailable('无法刷新本机 Codex 用量')
    }
    return state()
  }

  function stop() {
    stoppedByOwner = true
    sessionId += 1
    startNextAttempt = null
    clearPendingRequests('本机 Codex 已停止')
    rejectReadyWaiters('本机 Codex 已停止')
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

module.exports = { createCodexUsageService, mergeRateLimitSnapshot, resolveCodexLaunchAttempts }
