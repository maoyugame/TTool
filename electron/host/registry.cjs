// 连接注册表 + 生命周期（envelope）。net 现用，db 适配器后续复用。
//
// 折入设计评审：
//  - per-plugin + per-window 双上限（REV-6：单 webContents 无法按插件隔离 → 叠加 pluginId 计数）
//  - idle 回收仅回收「非忙碌且超时」连接，先收集 id 再删（REV-7：防杀执行中连接 / 防边遍历边改 Map）
//  - closeConnections（整页重载 / 崩溃时回收，保留计时器） vs closeAll（退出时回收并清计时器）

function createRegistry(opts = {}) {
  const maxPerPlugin = opts.maxPerPlugin || 16
  const maxTotal = opts.maxTotal || 64
  const idleMs = opts.idleMs || 30 * 60 * 1000

  const m = new Map() // id -> { id, kind, conn, pluginId, createdAt, lastUsedAt, busy, idleEvictable, teardown }
  let pendingTotal = 0 // 已预占但尚未落地的槽位（异步建连期间占名额，堵 TOCTOU）
  const pendingByPlugin = new Map()
  let generation = 0 // 代次：owner 清理时自增，作废此前所有在途预占（防 reload 期间落地的孤儿连接）
  let seq = 0
  const genId = (kind) => {
    seq += 1
    return kind + '_' + seq.toString(36)
  }

  function countByPlugin(pid) {
    let n = 0
    for (const e of m.values()) if (e.pluginId === pid) n += 1
    return n
  }

  // 预占一个名额：把上限判定与占位放在同一同步时刻，避免「先 canAdd 后异步 add」的并发击穿。
  // 成功返回 token（用于 release），失败返回 null。
  function reserve(pid) {
    const key = pid || ''
    if (m.size + pendingTotal >= maxTotal) return null
    if (countByPlugin(key) + (pendingByPlugin.get(key) || 0) >= maxPerPlugin) return null
    pendingTotal += 1
    pendingByPlugin.set(key, (pendingByPlugin.get(key) || 0) + 1)
    return { key, released: false, generation }
  }
  function release(token) {
    if (!token || token.released) return
    token.released = true
    // 陈旧令牌（其代次已被 closeConnections 整批清零）：仅标记已释放，不得再扣当前代次计数，
    // 否则会误减 reload 后新代次的 pending，反而放行超过上限的连接。
    if (token.generation !== generation) return
    pendingTotal = Math.max(0, pendingTotal - 1)
    const n = (pendingByPlugin.get(token.key) || 0) - 1
    if (n <= 0) pendingByPlugin.delete(token.key)
    else pendingByPlugin.set(token.key, n)
  }
  // 预占是否仍有效：token 未释放、且其代次未被 owner 清理作废。
  // 异步建连落地（add）前必须校验：失效则丢弃该连接，避免 reload 后落地的孤儿连接长存。
  function isReserved(token) {
    return !!token && !token.released && token.generation === generation
  }

  // opts.idleEvictable：是否参与 idle TTL 回收。net 持久连接默认 false（不被静默回收，
  // 交给 owner 清理 / 显式 close / 上限兜底）；未来 db「请求-响应后应归还」连接可设 true。
  function add(kind, conn, pid, teardown, opts) {
    const id = genId(kind)
    m.set(id, {
      id, kind, conn, pluginId: pid || '',
      createdAt: Date.now(), lastUsedAt: Date.now(),
      busy: false, idleEvictable: !!(opts && opts.idleEvictable), teardown,
    })
    return id
  }

  const get = (id) => m.get(id)
  const touch = (e) => { if (e) e.lastUsedAt = Date.now() }
  function setBusy(id, b) {
    const e = m.get(id)
    if (!e) return
    e.busy = !!b
    if (!b) e.lastUsedAt = Date.now()
  }

  function remove(id) {
    const e = m.get(id)
    if (!e) return false
    m.delete(id)
    try { if (e.teardown) e.teardown(e) } catch { /* 拆除失败忽略 */ }
    return true
  }

  // 两段式：先收集匹配 id，再统一删除，避免边遍历边改 Map。
  function closeWhere(pred) {
    const ids = []
    for (const [id, e] of m) if (pred(e)) ids.push(id)
    for (const id of ids) remove(id)
    return ids.length
  }

  // owner 清理（窗口销毁 / 渲染崩溃 / 整页重载）：删除已落地连接，并自增代次 + 清空预占计数，
  // 作废所有在途预占——使 reload 期间仍在握手的连接落地时被 isReserved 判定失效而即时丢弃。
  function closeConnections() {
    generation += 1
    pendingTotal = 0
    pendingByPlugin.clear()
    return closeWhere(() => true)
  }

  // idle 兜底：每 60s 扫描，仅回收「可回收 + 非忙碌 + 空闲超时」的连接。
  // net 持久连接 idleEvictable=false，不在此被回收（避免误杀长静默但存活的连接）。
  const timer = setInterval(() => {
    const now = Date.now()
    closeWhere((e) => e.idleEvictable && !e.busy && now - e.lastUsedAt > idleMs)
  }, 60 * 1000)
  if (timer.unref) timer.unref()

  function closeAll() {
    clearInterval(timer)
    closeConnections()
  }

  return { reserve, release, isReserved, add, get, touch, setBusy, remove, closeWhere, closeConnections, closeAll, size: () => m.size }
}

module.exports = { createRegistry }
