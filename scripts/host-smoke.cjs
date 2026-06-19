// 端到端冒烟：在真实 preload→IPC→主进程路径上验证 net / storage / secrets。
// 主进程起 setupHost + 一个本地 TCP echo 服务；renderer 经 window.ttool 调用并断言：
//   - storage：双 pluginId 命名空间隔离 + keys
//   - secrets：加密往返 + 落盘密文不含明文
//   - net：连本地 echo、写字节、收到回显、字节一致
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const net = require('node:net')
const { setupHost } = require('../electron/host/index.cjs')

// 隔离的临时 userData，避免污染真实数据
const USER_DATA = path.join(os.tmpdir(), 'ttool-host-smoke')
try { fs.rmSync(USER_DATA, { recursive: true, force: true }) } catch { /* ignore */ }
app.setName('ttool')
app.setPath('userData', USER_DATA)

const SECRET_PLAINTEXT = 's3cr3t-VALUE-xyz-' + 'check'
let win = null

app.whenReady().then(async () => {
  const host = setupHost({ ipcMain, app, getWin: () => win })

  // 本地 TCP echo 服务
  const echo = net.createServer((sock) => sock.on('data', (d) => sock.write(d)))
  await new Promise((r) => echo.listen(0, '127.0.0.1', r))
  const PORT = echo.address().port

  win = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  host.bindWindow(win)
  await win.loadURL('about:blank')

  const out = await win.webContents.executeJavaScript(`(async () => {
    const r = {}; const t = window.ttool;
    if (!t || !t.storage || !t.secrets || !t.net) return { fatal: 'window.ttool 能力缺失' };

    // storage 隔离
    await t.storage.set('pA', 'note', { v: 'A-note' });
    await t.storage.set('pB', 'note', { v: 'B-note' });
    const a = await t.storage.get('pA', 'note');
    const b = await t.storage.get('pB', 'note');
    r.storageIsolation = !!(a.ok && b.ok && a.value && b.value && a.value.v === 'A-note' && b.value.v === 'B-note');
    const ka = await t.storage.keys('pA');
    r.storageKeys = !!(ka.ok && ka.keys.indexOf('note') >= 0);
    const badNs = await t.storage.get('../evil', 'note');
    r.storageNsGuard = !!(badNs && badNs.ok === false && badNs.code === 'BAD_NS');

    // secrets 加密往返
    const av = await t.secrets.available();
    r.secretsAvailable = !!(av && av.available);
    const setR = await t.secrets.set('pA', 'token', ${JSON.stringify(SECRET_PLAINTEXT)});
    r.secretsSet = !!(setR && setR.ok);
    const getR = await t.secrets.get('pA', 'token');
    r.secretsRoundtrip = !!(getR && getR.ok && getR.value === ${JSON.stringify(SECRET_PLAINTEXT)});

    // storage 并发写不丢更新（P1 修复：串行 + 原子写）
    await Promise.all(Array.from({ length: 30 }, (_, i) => t.storage.set('pC', 'k' + i, { i })));
    const kc = await t.storage.keys('pC');
    r.storageConcurrency = !!(kc.ok && kc.keys.length === 30);

    // 连接上限并发不被击穿（P2 修复：reserve 预占）。maxPerPlugin=16，并发 20 连
    {
      const conns = await Promise.all(Array.from({ length: 20 }, () => t.net.connect({ host: '127.0.0.1', port: ${PORT} })));
      const okConns = conns.filter((c) => c && c.ok);
      const tooMany = conns.filter((c) => c && !c.ok && c.code === 'TOO_MANY_CONNS');
      r.netCap = okConns.length <= 16 && tooMany.length >= 1;
      r.netCapDetail = { ok: okConns.length, tooMany: tooMany.length };
      await Promise.all(okConns.map((c) => t.net.close(c.socketId)));
    }

    // net echo
    r.net = await new Promise((resolve) => {
      const expected = [10, 20, 30, 40, 250, 0, 255];
      t.net.connect({ host: '127.0.0.1', port: ${PORT} }).then((c) => {
        if (!c || !c.ok) { resolve({ connect: false, code: c && c.code }); return; }
        const chunks = [];
        const off = t.net.onData(c.socketId, (chunk) => {
          for (let i = 0; i < chunk.length; i++) chunks.push(chunk[i]);
          if (chunks.length >= expected.length) {
            off(); t.net.close(c.socketId);
            const match = expected.every((v, i) => chunks[i] === v);
            resolve({ connect: true, echo: match, got: chunks.slice(0, expected.length) });
          }
        });
        t.net.write(c.socketId, new Uint8Array(expected));
        setTimeout(() => resolve({ connect: true, echo: false, timeout: true, got: chunks }), 4000);
      }).catch((e) => resolve({ connect: false, error: String(e) }));
    });
    return r;
  })()`)

  // 落盘密文校验：secrets.json 不应含明文
  let secretsCiphertextOk = false
  try {
    const f = path.join(USER_DATA, 'plugins', 'pA', 'secrets.json')
    const raw = fs.readFileSync(f, 'utf8')
    secretsCiphertextOk = raw.length > 0 && raw.indexOf(SECRET_PLAINTEXT) === -1
  } catch (e) {
    secretsCiphertextOk = false
  }

  const checks = {
    storageIsolation: out.storageIsolation,
    storageKeys: out.storageKeys,
    storageNsGuard: out.storageNsGuard,
    secretsAvailable: out.secretsAvailable,
    secretsSet: out.secretsSet,
    secretsRoundtrip: out.secretsRoundtrip,
    secretsCiphertextOnDisk: secretsCiphertextOk,
    storageConcurrency: out.storageConcurrency,
    netCap: out.netCap,
    netConnect: out.net && out.net.connect,
    netEcho: out.net && out.net.echo,
  }
  console.log('RESULT ' + JSON.stringify({ checks, netCapDetail: out.netCapDetail, netDetail: out.net, fatal: out.fatal }, null, 2))
  const pass = Object.values(checks).every(Boolean) && !out.fatal
  console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL')

  echo.close()
  host.closeAll()
  app.quit()
  process.exitCode = pass ? 0 : 1
})
