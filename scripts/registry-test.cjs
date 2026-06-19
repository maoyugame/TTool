// registry.cjs 的确定性单测（纯 Node，无 electron 依赖）：锁死 reserve/release/generation 不变量，
// 重点覆盖 reload(closeConnections) 期间在途陈旧令牌的代次感知释放（防上限被绕过的回归）。
const { createRegistry } = require('../electron/host/registry.cjs')

let pass = true
const check = (name, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name)
  if (!cond) pass = false
}

// 1) reload 竞态：陈旧令牌 release 不得释放新代次名额（per-plugin 上限须守住）
{
  const r = createRegistry({ maxPerPlugin: 2, maxTotal: 100 })
  const stale = r.reserve('A') // gen0 预占
  check('stale reserved', !!stale)
  r.closeConnections() // gen++ + 清零 pending（模拟整页 reload）
  const a1 = r.reserve('A')
  const a2 = r.reserve('A') // 新代次填满 cap=2
  check('new-gen filled cap', !!a1 && !!a2)
  check('3rd rejected at cap', r.reserve('A') === null)
  r.release(stale) // 陈旧令牌落地（STALE/超时分支）—— 不得偷减新代次名额
  check('still rejected after stale release', r.reserve('A') === null)
}

// 2) reload 竞态：总数上限同样守住
{
  const r = createRegistry({ maxPerPlugin: 100, maxTotal: 3 })
  const s1 = r.reserve('x'); const s2 = r.reserve('y'); const s3 = r.reserve('z') // gen0 占满 total=3
  r.closeConnections()
  const n1 = r.reserve('a'); const n2 = r.reserve('b'); const n3 = r.reserve('c') // gen1 再占满
  check('new-gen total filled', !!n1 && !!n2 && !!n3)
  check('total cap rejects 4th', r.reserve('d') === null)
  r.release(s1); r.release(s2); r.release(s3) // 3 个陈旧令牌落地
  check('total cap still held after stale releases', r.reserve('d') === null)
}

// 3) 正常路径（无 reload）：release 照常释放名额
{
  const r = createRegistry({ maxPerPlugin: 2, maxTotal: 100 })
  const t1 = r.reserve('B'); r.reserve('B')
  check('normal: 3rd rejected', r.reserve('B') === null)
  r.release(t1)
  check('normal: reserve ok after release', r.reserve('B') !== null)
}

// 4) 成功路径：reserve→add→release（同代次）计数精确
{
  const r = createRegistry({ maxPerPlugin: 2, maxTotal: 100 })
  const t = r.reserve('C')
  r.add('net', { destroy() {} }, 'C', () => {}, { idleEvictable: false })
  r.release(t)
  check('success: size=1', r.size() === 1)
  check('success: one more reserve ok', r.reserve('C') !== null)
  check('success: then cap reached', r.reserve('C') === null)
}

console.log(pass ? 'REGISTRY TEST PASS' : 'REGISTRY TEST FAIL')
process.exit(pass ? 0 : 1)
