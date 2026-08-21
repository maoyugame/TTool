const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { createCodexUsageService, mergeRateLimitSnapshot, resolveCodexLaunchAttempts } = require('../electron/codex-usage.cjs')
const {
  DEFAULT_WIDGET_OPACITY,
  normalizeCodexUsageConfig,
  normalizeWidgetOpacity,
  readCodexUsageConfigFile,
  writeCodexUsageConfigFile,
} = require('../electron/codex-usage-config.cjs')

class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.writes = []
    this.killed = false
    this.stdin = {
      destroyed: false,
      write: (value) => this.writes.push(String(value)),
      end: () => { this.stdin.destroyed = true },
    }
    this.stdout = new EventEmitter()
    this.stdout.setEncoding = () => {}
    this.stderr = new EventEmitter()
  }

  kill() {
    this.killed = true
  }

  send(message) {
    this.stdout.emit('data', JSON.stringify(message) + '\n')
  }
}

const windowsEnv = { PATH: 'C:\\npm-bin;C:\\codex-bin', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
const windowsAttempts = resolveCodexLaunchAttempts({
  platform: 'win32',
  env: windowsEnv,
  existsSync: (candidate) => candidate === path.join('C:\\npm-bin', 'codex.cmd') || candidate === path.join('C:\\codex-bin', 'codex.exe'),
})
assert.equal(windowsAttempts[0].command, path.join('C:\\codex-bin', 'codex.exe'))
assert.deepEqual(windowsAttempts[0].args, ['app-server'])
assert.equal(windowsAttempts[1].command, windowsEnv.ComSpec)
assert.deepEqual(windowsAttempts[1].args, ['/d', '/s', '/c', 'codex.cmd app-server'])
assert.equal(windowsAttempts[1].options.env.PATH, 'C:\\npm-bin;' + windowsEnv.PATH)
assert.deepEqual(resolveCodexLaunchAttempts({ platform: 'darwin' }), [{ command: 'codex', args: ['app-server'], options: {} }])

assert.deepEqual(normalizeCodexUsageConfig({ enabled: true, widgetOpacity: 0.65 }), { enabled: true, widgetOpacity: 0.65 })
assert.deepEqual(normalizeCodexUsageConfig({ enabled: 0, widgetOpacity: -2 }), { enabled: false, widgetOpacity: 0.5 })
assert.equal(normalizeWidgetOpacity(9), 1)
assert.equal(normalizeWidgetOpacity(undefined), DEFAULT_WIDGET_OPACITY)
const persistedConfig = { content: null }
const configFs = {
  mkdirSync: () => {},
  writeFileSync: (_file, content) => { persistedConfig.content = content },
  readFileSync: () => persistedConfig.content,
}
assert.equal(writeCodexUsageConfigFile('C:\\config\\codex-usage-config.json', { enabled: true, widgetOpacity: 0.65 }, configFs), true)
assert.deepEqual(readCodexUsageConfigFile('C:\\config\\codex-usage-config.json', configFs), { enabled: true, widgetOpacity: 0.65 })

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8')
const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'tools', 'impl', 'codexUsage.tsx'), 'utf8')
const codexUsageWidgetStart = mainSource.indexOf('function showCodexUsageWidget()')
const codexUsageWidgetEnd = mainSource.indexOf('function destroyCodexUsageWidget()', codexUsageWidgetStart)
assert.ok(codexUsageWidgetStart >= 0 && codexUsageWidgetEnd > codexUsageWidgetStart, '找不到 Codex usage 悬浮窗实现范围')
const codexUsageWidgetSource = mainSource.slice(codexUsageWidgetStart, codexUsageWidgetEnd)
assert.match(mainSource, /ipcMain\.handle\('codex-usage:refresh', async \(\) => \{\s+await getCodexUsageService\(\)\.refresh\(\)/)
assert.match(mainSource, /clientVersion:\s*codexUsageClientVersion\(\)/)
assert.match(mainSource, /function codexUsageClientVersion\(\)[\s\S]*?app\.getVersion\(\)/)
assert.match(mainSource, /-webkit-app-region: drag/)
assert.doesNotMatch(codexUsageWidgetSource, /setIgnoreMouseEvents/)
assert.match(mainSource, /function resetCountdown\(value, now\)/)
assert.match(mainSource, /'余 ' \+ Math\.round\(100 - percent\) \+ '%'/)
assert.match(mainSource, /function freshnessText\(state, now\)/)
assert.match(mainSource, /window\.setInterval\(function \(\) \{ if \(latestState\) render\(latestState\) \}, 1000\)/)
assert.match(mainSource, /--widget-tick:/)
assert.match(mainSource, /\.bar::before\s*\{[^}]*z-index:\s*0;[^}]*pointer-events:\s*none;/)
assert.match(mainSource, /\.bar > i\s*\{[^}]*z-index:\s*1;/)
assert.match(preloadSource, /setWidgetOpacity: \(opacity\) => ipcRenderer\.invoke\('codex-usage:setWidgetOpacity', \{ opacity \}\)/)
assert.match(dashboardSource, /onPointerEnter=\{\(\) => setSelectedDate\(item\.date\)\}/)
assert.match(dashboardSource, /onFocus=\{\(\) => setSelectedDate\(item\.date\)\}/)
assert.match(dashboardSource, /onClick=\{\(\) => setSelectedDate\(item\.date\)\}/)
assert.match(dashboardSource, /aria-pressed=\{isSelected\}/)
assert.match(dashboardSource, /role="status" aria-live="polite"[^>]*>已选 \{selectedPoint\.date\} .*formatTokenCount\(selectedPoint\.tokens\)/)

function loadDashboardFormatters() {
  const sourceFile = path.join(__dirname, '..', 'src', 'tools', 'impl', 'codexUsage.tsx')
  const source = fs.readFileSync(sourceFile, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    fileName: sourceFile,
  })
  const dashboardModule = { exports: {} }
  const requireForDashboard = (request) => {
    if (request === 'react') return {}
    if (request === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null }
    if (request === '../../platform') return { platform: {} }
    if (request === '../registry') return { registerTool: () => {} }
    if (request === '../ui') return {}
    throw new Error(`Unexpected dashboard dependency: ${request}`)
  }
  vm.runInNewContext(compiled.outputText, {
    module: dashboardModule,
    exports: dashboardModule.exports,
    require: requireForDashboard,
    Date,
    Intl,
    Map,
    Set,
    Number,
    String,
    Math,
    Object,
    Array,
  }, { filename: sourceFile })
  return dashboardModule.exports
}

const {
  additionalCodexUsageLimits,
  codexUsageSummaryFacts,
  dailyUsageTrend,
  formatFreshness,
  formatResetCountdown,
  formatTokenCount,
  normalizedPercent,
} = loadDashboardFormatters()
const fixedNow = new Date(2026, 6, 15, 12, 0, 0).getTime()
assert.equal(normalizedPercent(-4), 0)
assert.equal(normalizedPercent(104), 100)
assert.equal(normalizedPercent('not-a-number'), null)
assert.equal(formatTokenCount(12_345), '12.35K tokens')
assert.equal(formatTokenCount(1_200_000), '1.20M tokens')
assert.equal(formatTokenCount(null), '— tokens')
assert.equal(formatTokenCount(true), '— tokens')
assert.equal(formatResetCountdown(fixedNow + 65_000, fixedNow), '距重置 1 分')
assert.equal(formatResetCountdown(fixedNow - 1, fixedNow), '正在等待重置')
assert.match(formatFreshness('ready', fixedNow - 120_001, fixedNow), /^数据可能已过期/)
assert.match(formatFreshness('error', fixedNow - 5_000, fixedNow), /^刷新失败，数据可能已过期/)
const dashboardState = {
  connection: 'ready', error: null, updatedAt: fixedNow, lastSuccessfulRefreshAt: fixedNow,
  usage: null, enabled: false, widgetVisible: false, widgetOpacity: 0.9,
  rateLimits: {
    rateLimits: { limitId: 'codex', limitName: 'Codex', primary: null, secondary: null, planType: null, rateLimitReachedType: null },
    rateLimitsByLimitId: {
      codex: { limitId: 'codex', limitName: 'Codex', primary: null, secondary: null, planType: null, rateLimitReachedType: null },
      gpt: { limitId: 'gpt', limitName: 'GPT', primary: null, secondary: null, planType: null, rateLimitReachedType: null },
      gptDuplicate: { limitId: 'gpt', limitName: 'GPT duplicate', primary: null, secondary: null, planType: null, rateLimitReachedType: null },
    },
  },
}
assert.deepEqual(Array.from(additionalCodexUsageLimits(dashboardState), ({ key }) => key), ['gpt'])
assert.deepEqual(
  Array.from(codexUsageSummaryFacts({ peakDailyTokens: 1200, currentStreakDays: 4, longestStreakDays: 11, longestRunningTurnSec: 65 }), ({ label, value }) => [label, value]),
  [['单日峰值', '1.20K tokens'], ['当前连续使用', '4 天'], ['最长连续使用', '11 天'], ['最长运行轮次', '1 分']],
)
const trend = dailyUsageTrend([
  { startDate: '2026-07-15', tokens: 7 },
  { startDate: '2026-07-08', tokens: 99 },
  { startDate: '2026-07-10', tokens: 20 },
  { startDate: '2026-07-09', tokens: 10 },
  { startDate: '2026-07-10', tokens: 3 },
  { startDate: 'invalid', tokens: 400 },
], 7, fixedNow)
assert.deepEqual(Array.from(trend, ({ tokens }) => tokens), [10, 23, 7])

const fallbackChild = new FakeChild()
const spawnCalls = []
const fallbackService = createCodexUsageService({
  platform: 'win32',
  env: windowsEnv,
  existsSync: (candidate) => candidate === path.join('C:\\npm-bin', 'codex.cmd') || candidate === path.join('C:\\codex-bin', 'codex.exe'),
  spawnImpl: (command, args, options) => {
    spawnCalls.push({ command, args, options })
    if (spawnCalls.length === 1) throw Object.assign(new Error('blocked App Execution Alias'), { code: 'EPERM' })
    return fallbackChild
  },
  pollIntervalMs: 60 * 60 * 1000,
})
fallbackService.start()
assert.equal(spawnCalls.length, 2, 'Windows .exe launch failure should fall back to the .cmd shim')
assert.equal(spawnCalls[0].command, path.join('C:\\codex-bin', 'codex.exe'))
assert.equal(spawnCalls[1].command, windowsEnv.ComSpec)
assert.deepEqual(spawnCalls[1].args, ['/d', '/s', '/c', 'codex.cmd app-server'])
assert.equal(JSON.parse(fallbackChild.writes[0]).method, 'initialize')
assert.equal(JSON.parse(fallbackChild.writes[0]).params.clientInfo.version, '0.0.0')
fallbackService.stop()

const failingChild = new FakeChild()
const asyncFallbackChild = new FakeChild()
const asyncFallbackCalls = []
const asyncFallbackService = createCodexUsageService({
  platform: 'win32',
  env: windowsEnv,
  existsSync: (candidate) => candidate === path.join('C:\\npm-bin', 'codex.cmd') || candidate === path.join('C:\\codex-bin', 'codex.exe'),
  spawnImpl: (command, args, options) => {
    asyncFallbackCalls.push({ command, args, options })
    return asyncFallbackCalls.length === 1 ? failingChild : asyncFallbackChild
  },
  pollIntervalMs: 60 * 60 * 1000,
})
asyncFallbackService.start()
failingChild.emit('error', new Error('blocked App Execution Alias'))
assert.equal(asyncFallbackCalls.length, 2, 'an async Windows .exe launch error should fall back to the .cmd shim')
assert.equal(asyncFallbackCalls[1].command, windowsEnv.ComSpec)
assert.equal(JSON.parse(asyncFallbackChild.writes[0]).method, 'initialize')
asyncFallbackService.stop()

const child = new FakeChild()
let spawns = 0
const service = createCodexUsageService({
  spawnImpl: () => {
    spawns += 1
    return child
  },
  pollIntervalMs: 60 * 60 * 1000,
  clientVersion: '0.3.0',
})

assert.equal(service.state().connection, 'idle')
assert.equal(spawns, 0, '未启用时不应启动 Codex 子进程')
service.start()
assert.equal(spawns, 1)
assert.equal(JSON.parse(child.writes[0]).method, 'initialize')
assert.equal(JSON.parse(child.writes[0]).params.clientInfo.version, '0.3.0')

child.send({ id: 1, result: { platformFamily: 'windows' } })
const methods = child.writes.map((line) => JSON.parse(line).method)
assert.deepEqual(methods.slice(1), ['initialized', 'account/rateLimits/read', 'account/usage/read'])

child.send({
  id: 2,
  result: {
    rateLimits: {
      limitId: 'codex',
      limitName: 'Codex',
      primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_784_000_000 },
      secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: 1_784_500_000 },
      credits: null,
      individualLimit: null,
      planType: 'plus',
      rateLimitReachedType: null,
    },
    rateLimitsByLimitId: null,
    rateLimitResetCredits: null,
  },
})
child.send({ id: 3, result: { summary: { lifetimeTokens: 1000 }, dailyUsageBuckets: [] } })
assert.equal(service.state().connection, 'ready')
assert.equal(service.state().rateLimits.rateLimits.primary.usedPercent, 25)
assert.equal(service.state().usage.summary.lifetimeTokens, 1000)
assert.equal(typeof service.state().lastSuccessfulRefreshAt, 'number')

async function verifyRefresh() {
  const refreshPromise = service.refresh()
  let refreshSettled = false
  void refreshPromise.then(() => { refreshSettled = true })
  const refreshMethods = child.writes.slice(-2).map((line) => JSON.parse(line).method)
  assert.deepEqual(refreshMethods, ['account/rateLimits/read', 'account/usage/read'])
  child.send({
    id: 4,
    result: {
      rateLimits: {
        limitId: 'codex',
        limitName: 'Codex',
        primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 1_784_000_000 },
        secondary: { usedPercent: 45, windowDurationMins: 10_080, resetsAt: 1_784_500_000 },
        credits: null,
        individualLimit: null,
        planType: 'plus',
        rateLimitReachedType: null,
      },
      rateLimitsByLimitId: null,
      rateLimitResetCredits: null,
    },
  })
  await Promise.resolve()
  assert.equal(refreshSettled, false, 'refresh must wait for every newly requested snapshot')
  child.send({ id: 5, result: { summary: { lifetimeTokens: 2000 }, dailyUsageBuckets: [] } })
  const refreshed = await refreshPromise
  assert.equal(refreshed.connection, 'ready')
  assert.equal(refreshed.rateLimits.rateLimits.primary.usedPercent, 30)
  assert.equal(refreshed.usage.summary.lifetimeTokens, 2000)

  const failedRefreshPromise = service.refresh()
  child.send({ id: 6, error: { code: -32000, message: 'hidden test error' } })
  const failedRefresh = await failedRefreshPromise
  assert.equal(failedRefresh.connection, 'error')
  assert.equal(failedRefresh.error, '无法读取 Codex 用量，请确认已在本机 Codex 登录')
  child.send({ id: 7, result: { summary: { lifetimeTokens: 2000 }, dailyUsageBuckets: [] } })

  const merged = mergeRateLimitSnapshot(service.state().rateLimits.rateLimits, { primary: { usedPercent: 30 } })
  assert.equal(merged.primary.usedPercent, 30)
  assert.equal(merged.primary.windowDurationMins, 300)

  service.stop()
  assert.equal(child.killed, true)
  assert.equal(service.state().connection, 'idle')
  console.log('codex usage service tests passed')
}

async function verifyRefreshFromIdle() {
  const idleChild = new FakeChild()
  const idleService = createCodexUsageService({
    spawnImpl: () => idleChild,
    pollIntervalMs: 60 * 60 * 1000,
  })
  const refreshPromise = idleService.refresh()
  let refreshSettled = false
  void refreshPromise.then(() => { refreshSettled = true })
  assert.equal(JSON.parse(idleChild.writes[0]).method, 'initialize')
  await Promise.resolve()
  assert.equal(refreshSettled, false, 'refresh from idle must wait for initialization and a new snapshot')
  idleChild.send({ id: 1, result: { platformFamily: 'windows' } })
  await Promise.resolve()
  const methods = idleChild.writes.map((line) => JSON.parse(line).method)
  assert.deepEqual(methods.slice(-2), ['account/rateLimits/read', 'account/usage/read'])
  idleChild.send({ id: 4, result: { rateLimits: null, rateLimitsByLimitId: null } })
  idleChild.send({ id: 5, result: { summary: { lifetimeTokens: 3000 }, dailyUsageBuckets: [] } })
  const refreshed = await refreshPromise
  assert.equal(refreshed.connection, 'ready')
  assert.equal(refreshed.usage.summary.lifetimeTokens, 3000)
  idleService.stop()
}

void Promise.all([verifyRefresh(), verifyRefreshFromIdle()]).catch((error) => {
  service.stop()
  console.error(error)
  process.exitCode = 1
})
