// DB 适配器真实验收（§11）：经真实 preload→IPC→主进程 路径连 docker 的 MySQL/Redis/Mongo，
// 校验连接、CRUD、类型保真（BIGINT/DECIMAL/DATE/JSON/BIT/BLOB）、Redis 二进制/RESP2/pipeline、
// Mongo EJSON 往返/createIndex/EJSON_INVALID。
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { setupHost } = require('../electron/host/index.cjs')

const USER_DATA = path.join(os.tmpdir(), 'ttool-db-smoke')
try { fs.rmSync(USER_DATA, { recursive: true, force: true }) } catch { /* ignore */ }
app.setName('ttool')
app.setPath('userData', USER_DATA)

const MYSQL = { host: '127.0.0.1', port: 13390, user: 'root', password: 'rootpw', database: 'testdb' }
const REDIS = { host: '127.0.0.1', port: 16399 }
const MONGO = { host: '127.0.0.1', port: 27019 }
let win = null

app.whenReady().then(async () => {
  const host = setupHost({ ipcMain, app, getWin: () => win })
  win = new BrowserWindow({
    width: 400, height: 300, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'electron', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  host.bindWindow(win)
  await win.loadURL('about:blank')

  const out = await win.webContents.executeJavaScript(`(async () => {
    const t = window.ttool; const r = {}; const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    if (!t || !t.db) return { fatal: 'window.ttool.db 缺失' };

    // ===== MySQL =====
    let mc;
    for (let i = 0; i < 15; i++) { mc = await t.db.mysql.connect(${JSON.stringify(MYSQL)}); if (mc.ok) break; await sleep(2000); }
    r.mysqlConnect = !!(mc && mc.ok); r.mysqlServerVersion = mc && mc.serverVersion;
    if (mc && mc.ok) {
      const id = mc.connId;
      await t.db.mysql.query(id, 'DROP TABLE IF EXISTS t1');
      await t.db.mysql.query(id, 'CREATE TABLE t1 (id INT PRIMARY KEY AUTO_INCREMENT, big BIGINT, dec1 DECIMAL(20,4), dt DATETIME, j JSON, b BIT(8), blob1 BLOB, txt TEXT, nm VARCHAR(50))');
      const ins = await t.db.mysql.query(id,
        "INSERT INTO t1 (big,dec1,dt,j,b,blob1,txt,nm) VALUES (9223372036854775807,'12345.6789','2026-06-20 12:34:56','{\\"k\\":1,\\"n\\":123}',b'10101010',?,'hello text','Alice')",
        [new Uint8Array([1, 2, 3, 250, 0, 255])]);
      r.mysqlInsert = !!(ins.ok && ins.result.kind === 'ok' && Number(ins.result.affectedRows) === 1 && ins.result.insertId);
      const q = await t.db.mysql.query(id, 'SELECT * FROM t1');
      const row = q.ok && q.result.rows[0];
      r.mysqlRowOk = !!row;
      if (row) {
        r.mysqlBigintString = row.big === '9223372036854775807';
        r.mysqlDecimalString = row.dec1 === '12345.6789';
        r.mysqlDatetimeString = typeof row.dt === 'string' && row.dt.indexOf('2026-06-20') === 0;
        r.mysqlJsonRaw = typeof row.j === 'string';
        r.mysqlBitString = row.b === '170';
        r.mysqlBlobBytes = (row.blob1 instanceof Uint8Array) && row.blob1[0] === 1 && row.blob1[5] === 255;
        r.mysqlTextString = row.txt === 'hello text';
        r.mysqlVarchar = row.nm === 'Alice';
        r.mysqlFields = !!(q.result.fields && q.result.fields.find((f) => f.name === 'big'));
      }
      const synErr = await t.db.mysql.query(id, 'SELEKT bad');
      r.mysqlSyntaxErr = synErr.ok === false && synErr.code === 'SYNTAX_ERR';
      await t.db.mysql.close(id);
    }

    // ===== Redis =====
    const rc = await t.db.redis.connect(${JSON.stringify(REDIS)});
    r.redisConnect = !!(rc && rc.ok);
    if (rc && rc.ok) {
      const id = rc.connId; const bytes = [0, 1, 2, 250, 255, 66];
      await t.db.redis.command(id, ['FLUSHDB']);
      await t.db.redis.command(id, ['SET', 'bk', new Uint8Array(bytes)]);
      const g = await t.db.redis.command(id, ['GET', 'bk'], { binary: true });
      r.redisBinary = !!(g.ok && g.reply instanceof Uint8Array && bytes.every((v, i) => g.reply[i] === v));
      await t.db.redis.command(id, ['SET', 'tk', 'hello']);
      const gt = await t.db.redis.command(id, ['GET', 'tk']);
      r.redisText = !!(gt.ok && gt.reply === 'hello');
      await t.db.redis.command(id, ['HSET', 'h', 'f1', 'v1', 'f2', 'v2']);
      const hg = await t.db.redis.command(id, ['HGETALL', 'h']);
      r.redisHgetallFlat = !!(hg.ok && Array.isArray(hg.reply) && hg.reply.length === 4 && hg.reply[0] === 'f1' && hg.reply[1] === 'v1');
      await t.db.redis.command(id, ['SET', 'c', '10']);
      const inc = await t.db.redis.command(id, ['INCR', 'c']);
      r.redisIncr = !!(inc.ok && inc.reply === 11);
      const pl = await t.db.redis.pipeline(id, [{ args: ['SET', 'p', '1'] }, { args: ['GET', 'p'] }]);
      r.redisPipeline = !!(pl.ok && pl.replies.length === 2 && pl.replies[1] === '1');
      const bad = await t.db.redis.command(id, []);
      r.redisBadArgs = bad.ok === false && bad.code === 'BAD_ARGS';
      await t.db.redis.close(id);
    }
    // 连不上时错误码须为 CONN_REFUSED（非 UNKNOWN）
    const rcErr = await t.db.redis.connect({ host: '127.0.0.1', port: 1 });
    r.redisConnErrCode = rcErr.ok === false && rcErr.code === 'CONN_REFUSED';

    // ===== MongoDB =====
    const moc = await t.db.mongo.connect(${JSON.stringify(MONGO)});
    r.mongoConnect = !!(moc && moc.ok);
    if (moc && moc.ok) {
      const id = moc.connId; const DB = 'testdb', C = 'c1';
      await t.db.mongo.deleteMany(id, DB, C, {});
      const ins = await t.db.mongo.insertOne(id, DB, C, { name: 'bob', when: { $date: '2026-06-20T00:00:00Z' }, big: { $numberLong: '9223372036854775807' }, price: { $numberDecimal: '12.50' } });
      r.mongoInsert = !!(ins.ok && ins.insertedId && ins.insertedId.$oid);
      const f = await t.db.mongo.find(id, DB, C, { filter: { name: 'bob' } });
      const d0 = f.ok && f.docs[0];
      r.mongoFindOid = !!(d0 && d0._id && d0._id.$oid);
      r.mongoFindDate = !!(d0 && d0.when && d0.when.$date);
      r.mongoFindLong = !!(d0 && d0.big && d0.big.$numberLong === '9223372036854775807');
      r.mongoFindDecimal = !!(d0 && d0.price && d0.price.$numberDecimal === '12.50');
      const byId = await t.db.mongo.find(id, DB, C, { filter: { _id: d0._id } });
      r.mongoFindByOid = !!(byId.ok && byId.docs.length === 1);
      const cnt = await t.db.mongo.countDocuments(id, DB, C, { name: 'bob' });
      r.mongoCount = !!(cnt.ok && cnt.count >= 1);
      const idx = await t.db.mongo.createIndex(id, DB, C, { name: 1 });
      r.mongoCreateIndexName = !!(idx.ok && typeof idx.name === 'string' && idx.name.length);
      const di = await t.db.mongo.distinct(id, DB, C, 'name', { name: 'bob' });
      r.mongoDistinct = !!(di.ok && Array.isArray(di.docs) && di.docs.indexOf('bob') >= 0);
      // 带 opts(maxTimeMS) 的 aggregate 应正常返回；$count 的 n 经 canonical EJSON 序列化为 {$numberInt}
      const ag = await t.db.mongo.aggregate(id, DB, C, [{ $match: { name: 'bob' } }, { $count: 'n' }], { maxTimeMS: 5000 });
      r.mongoAggregate = !!(ag.ok && Array.isArray(ag.docs) && ag.docs.length >= 1 && ag.docs[0] && 'n' in ag.docs[0]);
      const bdc = await t.db.mongo.find(id, '', 'c1', {});
      r.mongoBadDbColl = bdc.ok === false && bdc.code === 'BAD_ARGS';
      const bad = await t.db.mongo.find(id, DB, C, { filter: { _id: { $oid: 'not-valid-hex' } } });
      r.mongoEjsonInvalid = bad.ok === false && bad.code === 'EJSON_INVALID';
      const upd = await t.db.mongo.updateOne(id, DB, C, { name: 'bob' }, { $set: { tag: 'x' } });
      r.mongoUpdate = !!(upd.ok && upd.modifiedCount >= 1);
      const lc = await t.db.mongo.listCollections(id, DB);
      r.mongoListCollections = !!(lc.ok && lc.names.indexOf(C) >= 0);
      const rcmd = await t.db.mongo.runCommand(id, DB, { ping: 1 });
      r.mongoRunCommand = !!(rcmd.ok && rcmd.result);
      const del = await t.db.mongo.deleteMany(id, DB, C, { name: 'nonexistent-zzz' });
      r.mongoDelete = !!(del.ok && del.deletedCount === 0);
      await t.db.mongo.close(id);
    }
    return r;
  })()`)

  const groups = {
    mysql: ['mysqlConnect', 'mysqlInsert', 'mysqlRowOk', 'mysqlBigintString', 'mysqlDecimalString', 'mysqlDatetimeString', 'mysqlJsonRaw', 'mysqlBitString', 'mysqlBlobBytes', 'mysqlTextString', 'mysqlVarchar', 'mysqlFields', 'mysqlSyntaxErr'],
    redis: ['redisConnect', 'redisBinary', 'redisText', 'redisHgetallFlat', 'redisIncr', 'redisPipeline', 'redisBadArgs', 'redisConnErrCode'],
    mongo: ['mongoConnect', 'mongoInsert', 'mongoFindOid', 'mongoFindDate', 'mongoFindLong', 'mongoFindDecimal', 'mongoFindByOid', 'mongoCount', 'mongoCreateIndexName', 'mongoDistinct', 'mongoAggregate', 'mongoBadDbColl', 'mongoEjsonInvalid', 'mongoUpdate', 'mongoListCollections', 'mongoRunCommand', 'mongoDelete'],
  }
  let pass = !out.fatal
  const report = {}
  for (const [g, keys] of Object.entries(groups)) {
    report[g] = {}
    for (const k of keys) { report[g][k] = out[k] === true; if (out[k] !== true) pass = false }
  }
  console.log('RESULT ' + JSON.stringify({ report, serverVersion: out.mysqlServerVersion, fatal: out.fatal, raw: out }, null, 2))
  console.log(pass ? 'DB SMOKE PASS' : 'DB SMOKE FAIL')
  host.closeAll()
  app.quit()
  process.exitCode = pass ? 0 : 1
})
