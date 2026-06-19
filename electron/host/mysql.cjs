// platform.db.mysql 适配器（mysql2）。单连接保会话态；typeCast 矩阵保真。
// 语义见 HOST-DB-SPEC.md §4。
const mysql = require('mysql2/promise')
const { doConnect, withConn, truncateRows } = require('./dbutil.cjs')

// columnType(数字) → 可读类型名（用于 fields 元数据，可选）
const TYPE_NAMES = {
  0x00: 'DECIMAL', 0x01: 'TINYINT', 0x02: 'SMALLINT', 0x03: 'INT', 0x04: 'FLOAT', 0x05: 'DOUBLE',
  0x07: 'TIMESTAMP', 0x08: 'BIGINT', 0x09: 'MEDIUMINT', 0x0a: 'DATE', 0x0b: 'TIME', 0x0c: 'DATETIME',
  0x0d: 'YEAR', 0x10: 'BIT', 0xf5: 'JSON', 0xf6: 'DECIMAL', 0xf7: 'ENUM', 0xf8: 'SET',
  0xf9: 'TINYBLOB', 0xfa: 'MEDIUMBLOB', 0xfb: 'LONGBLOB', 0xfc: 'BLOB', 0xfd: 'VARCHAR', 0xfe: 'CHAR', 0xff: 'GEOMETRY',
}
const fieldType = (f) => {
  const t = typeof f.columnType === 'number' ? f.columnType : f.type
  return typeof t === 'number' ? TYPE_NAMES[t] || String(t) : undefined
}

// typeCast 集中归一化：JSON→原始字符串、BIT→数值字符串、GEOMETRY→解析对象；
// 其余 next()（默认解析，尊重 dateStrings / supportBigNumbers / bigNumberStrings：
// DATE/DATETIME/TIMESTAMP→字符串、BIGINT/DECIMAL→字符串、二进制 BLOB→Buffer 后续转 Uint8Array）。
function typeCast(field, next) {
  if (field.type === 'JSON') return field.string('utf8')
  if (field.type === 'BIT') {
    const b = field.buffer()
    if (b == null) return null
    return b.length ? BigInt('0x' + b.toString('hex')).toString() : '0'
  }
  if (field.type === 'GEOMETRY') return field.geometry()
  return next()
}

function setupMysql({ ipcMain, registry }) {
  ipcMain.handle('db:mysql:connect', async (_e, config = {}) => {
    const c = config || {}
    if (!c.host) return { ok: false, code: 'BAD_ARGS', error: '缺少 host' }
    let ssl
    if (c.ssl === true) ssl = {}
    else if (c.ssl && typeof c.ssl === 'object') ssl = c.ssl
    return doConnect({
      registry,
      kind: 'mysql',
      pluginId: c.pluginId,
      connectFn: () =>
        mysql.createConnection({
          host: c.host,
          port: c.port || 3306,
          user: c.user,
          password: c.password,
          database: c.database,
          ssl,
          connectTimeout: c.connectTimeoutMs || 10000,
          multipleStatements: false, // 一次一条，防注入串改
          dateStrings: true,
          supportBigNumbers: true,
          bigNumberStrings: true,
          timezone: 'Z',
          decimalNumbers: false,
          typeCast,
        }),
      teardownFn: (conn) => conn.end(),
      serverVersionFn: async (conn) => {
        const [r] = await conn.query('SELECT VERSION() AS v')
        return r && r[0] && r[0].v
      },
    })
  })

  ipcMain.handle('db:mysql:query', async (_e, { connId, sql, params, maxRows } = {}) => {
    if (typeof sql !== 'string' || !sql) return { ok: false, code: 'BAD_ARGS', error: 'sql 非法' }
    return withConn(registry, connId, async (conn) => {
      // 二进制参数 Uint8Array → Buffer，使 mysql2 正确转义为 X'..'（否则会被当对象）
      const p = Array.isArray(params) ? params.map((x) => (x instanceof Uint8Array ? Buffer.from(x) : x)) : undefined
      const [rowsOrHeader, fields] = await conn.query(sql, p)
      if (Array.isArray(rowsOrHeader)) {
        const t = truncateRows(rowsOrHeader, maxRows)
        if (t.error === 'TOO_BIG') return { ok: false, code: 'RESULT_TRUNCATED', error: '单个字段值过大，请用投影/分页或避免取大 BLOB' }
        return {
          ok: true,
          result: {
            kind: 'rows',
            rows: t.rows,
            fields: (fields || []).map((f) => ({ name: f.name, type: fieldType(f) })),
            truncated: t.truncated,
          },
        }
      }
      const h = rowsOrHeader || {}
      return {
        ok: true,
        result: {
          kind: 'ok',
          affectedRows: h.affectedRows,
          insertId: h.insertId != null ? String(h.insertId) : undefined,
          changedRows: h.changedRows,
        },
      }
    })
  })

  ipcMain.handle('db:mysql:close', async (_e, { connId } = {}) => {
    registry.remove(connId)
    return { ok: true }
  })

  ipcMain.handle('db:mysql:ping', async (_e, { connId } = {}) =>
    withConn(registry, connId, async (conn) => {
      await conn.ping()
      return { ok: true }
    })
  )
}

module.exports = { setupMysql }
