// platform.db.mongo 适配器（mongodb v6 + bson EJSON canonical）。语义见 HOST-DB-SPEC.md §6。
// 入参为 Extended JSON plain object（{$oid}/{$date} 等）→ EJSON.deserialize 成 BSON；
// 出参 EJSON.serialize(relaxed:false) 成 canonical extended-JSON，IPC 安全。
const { MongoClient } = require('mongodb')
const { EJSON } = require('bson')
const { doConnect, withConn, MAX_ROWS_HARD, MAX_TOTAL_BYTES, MAX_VALUE_BYTES } = require('./dbutil.cjs')

const toEJSON = (v) => EJSON.serialize({ v }, { relaxed: false }).v

// 数据入参（filter/doc/update/pipeline/keys）：relaxed:false 保留 $numberLong→Long 等精确类型。
function fromEJSON(v) {
  if (v == null) return v
  try {
    return EJSON.deserialize(v, { relaxed: false })
  } catch {
    const err = new Error('入参不是合法 Extended JSON')
    err.__ejson = true
    throw err
  }
}
// 选项入参（maxTimeMS/batchSize/upsert/collation 等控制参数）：relaxed:true，避免把数值塌成
// BSON 包装对象（Int32 等）——否则驱动的 typeof===number 守卫（如 maxTimeMS）会失效而静默丢弃选项。
function fromOpts(v) {
  if (v == null) return undefined
  try {
    return EJSON.deserialize(v, { relaxed: true })
  } catch {
    const err = new Error('opts 不是合法 Extended JSON')
    err.__ejson = true
    throw err
  }
}

const badArgs = (msg) => {
  const e = new Error(msg || 'db/coll/参数非法')
  e.__badargs = true
  return e
}
function coll(client, db, name) {
  if (typeof db !== 'string' || !db || typeof name !== 'string' || !name) throw badArgs('db/coll 非法')
  return client.db(db).collection(name)
}
function ckDb(db) {
  if (typeof db !== 'string' || !db) throw badArgs('db 非法')
  return db
}

// 序列化文档数组：限行数 + 累计字节封顶（含首文档）+ 单文档硬上限。
function serializeDocs(docs, maxRows) {
  const cap = Math.min(Math.max(1, maxRows || 5000), MAX_ROWS_HARD)
  const out = []
  let total = 0
  let truncated = false
  for (let i = 0; i < docs.length; i++) {
    if (out.length >= cap) { truncated = true; break }
    const ej = EJSON.serialize(docs[i], { relaxed: false })
    const bytes = Buffer.byteLength(JSON.stringify(ej))
    if (bytes > MAX_VALUE_BYTES) return { error: 'TOO_BIG' }
    if (total + bytes > MAX_TOTAL_BYTES) {
      if (out.length === 0) return { error: 'TOO_BIG' }
      truncated = true
      break
    }
    out.push(ej)
    total += bytes
  }
  return { docs: out, truncated }
}
const TOO_BIG_RESP = { ok: false, code: 'RESULT_TRUNCATED', error: '结果过大，请用投影裁字段或分页' }

function setupMongo({ ipcMain, registry }) {
  // 统一包装：连接忙碌管理 + 把 __ejson/__badargs 标记错误归一为 EJSON_INVALID / BAD_ARGS。
  const mop = (connId, fn) =>
    withConn(registry, connId, async (client) => {
      try {
        return await fn(client)
      } catch (e) {
        if (e && e.__ejson) return { ok: false, code: 'EJSON_INVALID', error: e.message || '入参不是合法 Extended JSON' }
        if (e && e.__badargs) return { ok: false, code: 'BAD_ARGS', error: e.message || '参数非法' }
        throw e
      }
    })

  ipcMain.handle('db:mongo:connect', async (_e, config = {}) => {
    const c = config || {}
    if (!c.uri && !c.host) return { ok: false, code: 'BAD_ARGS', error: '缺少 uri 或 host' }
    return doConnect({
      registry,
      kind: 'mongo',
      pluginId: c.pluginId,
      connectFn: async () => {
        let uri = c.uri
        if (!uri) {
          const auth = c.user ? encodeURIComponent(c.user) + (c.password ? ':' + encodeURIComponent(c.password) : '') + '@' : ''
          uri = `mongodb://${auth}${c.host}:${c.port || 27017}/`
        }
        const opts = { serverSelectionTimeoutMS: c.connectTimeoutMs || 10000 }
        if (c.authSource) opts.authSource = c.authSource
        if (c.replicaSet) opts.replicaSet = c.replicaSet
        if (c.tls) opts.tls = true
        const client = new MongoClient(uri, opts)
        await client.connect()
        try {
          await client.db(c.authSource || 'admin').command({ ping: 1 }) // 验证可达 + 认证
        } catch (e) {
          try { await client.close() } catch { /* ignore */ } // 防认证失败时 client 句柄泄漏
          throw e
        }
        return client
      },
      teardownFn: (client) => client.close(),
      serverVersionFn: async (client) => {
        const r = await client.db('admin').command({ buildInfo: 1 })
        return r && r.version
      },
    })
  })

  ipcMain.handle('db:mongo:listDatabases', async (_e, { connId } = {}) =>
    mop(connId, async (client) => {
      const r = await client.db('admin').admin().listDatabases()
      return { ok: true, names: (r.databases || []).map((d) => d.name) }
    })
  )

  ipcMain.handle('db:mongo:listCollections', async (_e, { connId, db } = {}) =>
    mop(connId, async (client) => {
      ckDb(db)
      const arr = await client.db(db).listCollections({}, { nameOnly: true }).toArray()
      return { ok: true, names: arr.map((x) => x.name) }
    })
  )

  ipcMain.handle('db:mongo:find', async (_e, { connId, db, coll: cn, opts, maxRows } = {}) =>
    mop(connId, async (client) => {
      const c = coll(client, db, cn)
      const op = opts || {}
      const o = {}
      if (op.projection != null) o.projection = fromEJSON(op.projection)
      if (op.sort != null) o.sort = fromEJSON(op.sort)
      if (typeof op.limit === 'number') o.limit = op.limit
      if (typeof op.skip === 'number') o.skip = op.skip
      const docs = await c.find(fromEJSON(op.filter || {}), o).toArray()
      const s = serializeDocs(docs, maxRows)
      if (s.error === 'TOO_BIG') return TOO_BIG_RESP
      return { ok: true, docs: s.docs, truncated: s.truncated }
    })
  )

  ipcMain.handle('db:mongo:countDocuments', async (_e, { connId, db, coll: cn, filter } = {}) =>
    mop(connId, async (client) => {
      const count = await coll(client, db, cn).countDocuments(fromEJSON(filter || {}))
      return { ok: true, count }
    })
  )

  ipcMain.handle('db:mongo:aggregate', async (_e, { connId, db, coll: cn, pipeline, opts, maxRows } = {}) =>
    mop(connId, async (client) => {
      const p = fromEJSON(pipeline) || []
      if (!Array.isArray(p)) return { ok: false, code: 'BAD_ARGS', error: 'pipeline 须为数组' }
      const docs = await coll(client, db, cn).aggregate(p, fromOpts(opts)).toArray()
      const s = serializeDocs(docs, maxRows)
      if (s.error === 'TOO_BIG') return TOO_BIG_RESP
      return { ok: true, docs: s.docs, truncated: s.truncated }
    })
  )

  ipcMain.handle('db:mongo:distinct', async (_e, { connId, db, coll: cn, field, filter, options } = {}) =>
    mop(connId, async (client) => {
      if (typeof field !== 'string' || !field) throw badArgs('field 非法')
      const values = await coll(client, db, cn).distinct(field, fromEJSON(filter || {}), fromOpts(options))
      const s = serializeDocs(values, 50000)
      if (s.error === 'TOO_BIG') return TOO_BIG_RESP
      return { ok: true, docs: s.docs, truncated: s.truncated }
    })
  )

  const write = (channel, run) => ipcMain.handle(channel, async (_e, payload = {}) => mop(payload.connId, (client) => run(client, payload)))

  write('db:mongo:insertOne', async (client, { db, coll: cn, doc }) => {
    const r = await coll(client, db, cn).insertOne(fromEJSON(doc))
    return { ok: true, insertedId: toEJSON(r.insertedId) }
  })
  write('db:mongo:insertMany', async (client, { db, coll: cn, docs }) => {
    if (!Array.isArray(docs)) return { ok: false, code: 'BAD_ARGS', error: 'docs 须为数组' }
    const r = await coll(client, db, cn).insertMany(docs.map((d) => fromEJSON(d)))
    return { ok: true, insertedIds: Object.values(r.insertedIds || {}).map(toEJSON) }
  })
  write('db:mongo:updateOne', async (client, { db, coll: cn, filter, update, opts }) => {
    const r = await coll(client, db, cn).updateOne(fromEJSON(filter), fromEJSON(update), fromOpts(opts))
    return { ok: true, matchedCount: r.matchedCount, modifiedCount: r.modifiedCount, upsertedId: r.upsertedId ? toEJSON(r.upsertedId) : undefined }
  })
  write('db:mongo:updateMany', async (client, { db, coll: cn, filter, update, opts }) => {
    const r = await coll(client, db, cn).updateMany(fromEJSON(filter), fromEJSON(update), fromOpts(opts))
    return { ok: true, matchedCount: r.matchedCount, modifiedCount: r.modifiedCount, upsertedId: r.upsertedId ? toEJSON(r.upsertedId) : undefined }
  })
  write('db:mongo:replaceOne', async (client, { db, coll: cn, filter, update, opts }) => {
    const r = await coll(client, db, cn).replaceOne(fromEJSON(filter), fromEJSON(update), fromOpts(opts))
    return { ok: true, matchedCount: r.matchedCount, modifiedCount: r.modifiedCount, upsertedId: r.upsertedId ? toEJSON(r.upsertedId) : undefined }
  })
  write('db:mongo:deleteOne', async (client, { db, coll: cn, filter }) => {
    const r = await coll(client, db, cn).deleteOne(fromEJSON(filter))
    return { ok: true, deletedCount: r.deletedCount }
  })
  write('db:mongo:deleteMany', async (client, { db, coll: cn, filter }) => {
    const r = await coll(client, db, cn).deleteMany(fromEJSON(filter))
    return { ok: true, deletedCount: r.deletedCount }
  })

  ipcMain.handle('db:mongo:listIndexes', async (_e, { connId, db, coll: cn } = {}) =>
    mop(connId, async (client) => {
      const docs = await coll(client, db, cn).listIndexes().toArray()
      const s = serializeDocs(docs, 1000)
      if (s.error === 'TOO_BIG') return TOO_BIG_RESP
      return { ok: true, docs: s.docs, truncated: s.truncated }
    })
  )
  write('db:mongo:createIndex', async (client, { db, coll: cn, keys, opts }) => {
    const name = await coll(client, db, cn).createIndex(fromEJSON(keys), fromOpts(opts))
    return { ok: true, name }
  })
  ipcMain.handle('db:mongo:dropIndex', async (_e, { connId, db, coll: cn, name } = {}) =>
    mop(connId, async (client) => {
      if (typeof name !== 'string' || !name) throw badArgs('name 非法')
      await coll(client, db, cn).dropIndex(name)
      return { ok: true }
    })
  )

  ipcMain.handle('db:mongo:runCommand', async (_e, { connId, db, command } = {}) =>
    mop(connId, async (client) => {
      ckDb(db)
      const r = await client.db(db).command(fromEJSON(command))
      return { ok: true, result: toEJSON(r) }
    })
  )

  ipcMain.handle('db:mongo:close', async (_e, { connId } = {}) => {
    registry.remove(connId)
    return { ok: true }
  })
  ipcMain.handle('db:mongo:ping', async (_e, { connId } = {}) =>
    mop(connId, async (client) => {
      await client.db('admin').command({ ping: 1 })
      return { ok: true }
    })
  )
}

module.exports = { setupMongo }
