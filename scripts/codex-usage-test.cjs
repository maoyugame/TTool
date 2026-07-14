const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createCodexUsageService, mergeRateLimitSnapshot } = require('../electron/codex-usage.cjs')

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

const child = new FakeChild()
let spawns = 0
const service = createCodexUsageService({
  spawnImpl: () => {
    spawns += 1
    return child
  },
  pollIntervalMs: 60 * 60 * 1000,
})

assert.equal(service.state().connection, 'idle')
assert.equal(spawns, 0, '未启用时不应启动 Codex 子进程')
service.start()
assert.equal(spawns, 1)
assert.equal(JSON.parse(child.writes[0]).method, 'initialize')

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

const merged = mergeRateLimitSnapshot(service.state().rateLimits.rateLimits, { primary: { usedPercent: 30 } })
assert.equal(merged.primary.usedPercent, 30)
assert.equal(merged.primary.windowDurationMins, 300)

service.stop()
assert.equal(child.killed, true)
assert.equal(service.state().connection, 'idle')
console.log('codex usage service tests passed')
