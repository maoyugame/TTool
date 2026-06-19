// 按文件串行化的原子 JSON 读改写。供 storage / secrets 复用，消除丢更新与损坏静默清空。
//  - withFileLock：同一文件的操作串行执行（promise 链），杜绝并发读-改-写交错丢更新。
//  - readJson：文件不存在返回 {}；存在但解析失败抛 STORE_CORRUPT（绝不静默当空，避免下次写覆盖真数据）。
//  - atomicWrite：先写 .tmp 再 rename（同目录 rename 原子），杜绝半截/损坏文件。
const fsp = require('node:fs/promises')
const path = require('node:path')

const locks = new Map() // file -> 永不 reject 的链尾

function withFileLock(file, fn) {
  const prev = locks.get(file) || Promise.resolve()
  const run = prev.then(() => fn())
  const tail = run.then(() => {}, () => {})
  locks.set(file, tail)
  // 链跑空即回收该 key（仅当自己仍是当前链尾，避免删掉后继者的链），保持 locks 有界。
  tail.then(() => { if (locks.get(file) === tail) locks.delete(file) })
  return run
}

async function readJson(file) {
  let raw
  try {
    raw = await fsp.readFile(file, 'utf8')
  } catch (e) {
    if (e && e.code === 'ENOENT') return {}
    throw e
  }
  try {
    return JSON.parse(raw)
  } catch {
    const err = new Error('存储文件已损坏')
    err.code = 'STORE_CORRUPT'
    throw err
  }
}

async function atomicWrite(file, obj) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  await fsp.writeFile(tmp, JSON.stringify(obj), 'utf8')
  try {
    await fsp.rename(tmp, file)
  } catch (err) {
    // rename 失败（Windows 上目标被杀软/索引器短暂占用抛 EPERM/EBUSY 常见）：清理残留 tmp 再抛。
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

module.exports = { withFileLock, readJson, atomicWrite }
