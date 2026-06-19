# TTool 宿主网络与数据库能力规范（net + db 分层 · 定稿 v2）

> TTool 宿主侧「网络/数据库连接代理」能力的**统一权威规范**。供宿主团队实现，供数据库/网络类插件依赖。
> **架构方向（已定）**：分两层——
> 1. **`platform.net`：通用 TCP/TLS 字节管道**（底座）。任意 TCP 协议的插件直接用它，**永不为新协议改 SDK**，解决「渲染层不能 TCP」的根因。
> 2. **`platform.db.{mysql,redis,mongo}`：主流库便利层**。宿主持成熟驱动，白送协议+认证+TLS+连接管理；因为成熟 DB 驱动是 Node 库、在沙箱渲染层跑不起来，重写其认证/TLS 不现实，故对主流库用宿主驱动。
>
> 适用 SDK 版本：**v1**（`manifest.sdk="1"` 不变）。整套为 **additive**。本稿已折入设计评审确认的 20 项改进（标 ✅REV-n）。
>
> **实现进度**：net + storage + secrets 已实现并端到端验证（见 `electron/host/`、SDK `useNet/useStorage/useSecrets`）。db 适配器（mysql/redis/mongo）按本规范 §10 顺序后续实现，复用同一 envelope（`electron/host/registry.cjs`）。

---

## 0. 设计取舍与对早期 MySQL 草案的评估

- 早期 MySQL-only 草案（`ttoolplugin/mysql/HOST-DB-SPEC.md`）**判断正确，予以采纳**为本框架的 MySQL 实例（主进程持驱动、单连接保会话态、`multipleStatements:false`、结果/错误归一化）。
- **为何 net 不能取代 db**：`mysql2`/`mongodb`/`ioredis` 依赖 `net`/`tls`/`crypto`/`Buffer`/`Stream` 等 Node 内置，在沙箱渲染层无法运行；给了 TCP 管道，插件也无法直接复用这些驱动，须自行重写协议+认证(`caching_sha2_password`/`SCRAM-SHA-256`)+TLS，对 MySQL/Mongo 不现实。故 **net=通用底座，db=主流库便利层**，两者共用同一 envelope。需要冷门协议（PG/MQTT/自定义二进制…）的插件用 `net` 自实现，零 SDK 改动。

---

## 1. 统一架构

```
插件(渲染进程, 沙箱: nodeIntegration:false / contextIsolation:true)
  │ platform.net.connect/write/onData/close        ← 通用底座（已实现）
  │ platform.db.mysql.query / redis.command / mongo.find …  ← 便利层（后续）
  ▼ preload.cjs  window.ttool.{net,db,storage,secrets}.*  → ipcRenderer.invoke / ipcRenderer.on
  ▼ electron/host/index.cjs (主进程：统一 connId/socketId 注册表 + 生命周期 + 错误归一化)
        ├─ net.cjs   (node net/tls 原始套接字多路复用)  ← 已实现
        ├─ storage.cjs / secrets.cjs (命名空间 KV / safeStorage 加密)  ← 已实现
        ├─ mysql.cjs (mysql2)   ← 后续
        ├─ redis.cjs (ioredis)  ← 后续
        └─ mongo.cjs (mongodb)  ← 后续
  ▼ 任意 TCP 服务 / MySQL(3306) / Redis(6379) / MongoDB(27017)（原始 TCP，仅主进程接触）
```

**分层职责**
- **共享 envelope**（`registry.cjs`）：统一注册表、id 生成、生命周期（§2.2）、上限（per-plugin + per-window）。net 现用，db 复用。
- **驱动与 net 仅主进程 require，渲染层永不接触。**
- **platform 适配层**：`platform.net?` / `platform.db?`（仅桌面；web 下 `undefined`）。
- **SDK 类型**：`@maoyugames/ttool-sdk` 的 `platform` 新增 `net?` / `db?`（v1 only-add）。

---

## 2. 通用契约（net 与 db 共同遵守）

### 2.1 标识与会话
- `connect(...)` 成功返回不透明 id（`net_*`/`my_*`/`rd_*`/`mg_*`）+（DB）`serverVersion`；失败见 §2.3。
- 同一 id 的操作**串行**于同一物理连接/客户端，会话态保持。
- `close(id)` 幂等；`ping(id)` 探活。

### 2.2 生命周期与泄漏防护 ✅REV-6/7/8/15
- **注册表项**：`{ id, kind, conn, ownerWebContentsId, pluginId?, createdAt, lastUsedAt, busy, idleEvictable }`。
- **预占防并发击穿**：`reserve(pluginId)` 在上限判定的同一同步时刻占名额，堵 connect 的 TOCTOU；成功转正式条目时 `release`，失败/超时也 `release`。
- **busy 互斥 + idleEvictable**：idle 扫描仅回收 `idleEvictable && !busy && 空闲超时` 的连接。net 持久连接 `idleEvictable:false`（不被静默回收，交给 owner 清理 / 显式 close / 上限兜底）；db「请求-响应后归还」连接可设 true。两段式删除（先收集 id 再删）。
- **owner 清理触发点（完整）**：`destroyed`、`render-process-gone`（崩溃秒级回收）、`did-start-navigation`（用 details 对象，仅 `isMainFrame && !isSameDocument` 视为整页重载才清理；同文档导航忽略）。
- **连接上限**：per-plugin（默认 16）+ per-window（默认 64），按 `pluginId` 二级计数（pluginId 经 safePluginId 归一，空/非法归入保留桶）。> 单 webContents 下 owner 无法按插件硬隔离，故叠加 per-plugin 计数 + SDK 卸载自动 close（已实现）。

### 2.3 统一响应壳与错误码 ✅REV-4/12/18
- **成功**：顶层恒含 `{ ok:true, durationMs }`，载荷放各操作字段；`durationMs` 一律顶层。
- **失败**（不 reject）：`{ ok:false, error, code:UnifiedCode, driverCode?, errno? }`。`code` 必须是统一枚举：
  ```
  AUTH_FAILED | CONN_REFUSED | TIMEOUT | DNS_FAIL | TLS_FAIL
  NO_CONN | STALE_CONN | TOO_MANY_CONNS | BAD_ARGS
  DUP_KEY | SYNTAX_ERR | EJSON_INVALID | RESULT_TRUNCATED | UNKNOWN
  ```
  错误回传前对 `password` 字段与 URI `user:pass@` 段做脱敏（`redact`，已实现于 util.cjs）。

### 2.4 序列化与类型保真 ✅REV-9/10/20
- **二进制** → `Buffer`（clone 成 `Uint8Array`）。
- **整数精度统一阈值**：`|v| > 2^53-1` 一律字符串返回。`DECIMAL`/`Decimal128`→字符串。
- **日期**：MySQL `dateStrings:true` + connect 固定 `timezone:'Z'`；Mongo `Date`→EJSON `{$date}`。
- **MongoDB 全程 EJSON canonical**，仅接受「已是 extended-JSON 的 plain object」单一入参路径；`EJSON.deserialize` 失败 → `{ok:false,code:'EJSON_INVALID'}`；序列化前防循环引用。
- structured clone 是两端同步深拷贝，大对象会阻塞两端 → 必须配合 §2.5。

### 2.5 结果体量封顶（行数 + 字节 + 单值三重） ✅REV-9/19
- **行/元素数软上限**：`maxRows` 默认 5000，取 `min(传入, 硬上限 50000)`。
- **累计字节预算**：超 ~16MB 截断 `truncated:true`（`code:'RESULT_TRUNCATED'`）。
- **单值上限**：单个 BLOB/大文档/大 value 超 ~1MB → 截断 + 元信息。Mongo 因 EJSON 膨胀字节预算更小。Redis 大 reply 同受字节封顶。
- v1 不做跨 IPC 流式游标；大数据由插件分页。

### 2.6 桌面专属与降级
仅 Electron 提供；web 下为 `undefined`，插件检测后提示「仅桌面版支持」。

### 2.7 安全与凭证 ✅REV-16/17
- **威胁模型（显式纳入）**：主进程能向任意 host:port 发起 TCP（net 直接、db 经驱动），构成 SSRF/内网扫描原语。受信任模型下接受，但要求：① 安装链路加固（release 来源校验、声明使用 net/db 能力时显式授权提示）；② 可选目标策略钩子（禁止/告警云元数据 `169.254.169.254` 与私网段，疑似批量探测限流）；③ 探测可疑时错误码降级为统一 `CONN_REFUSED` 不泄漏指纹。
- **凭证安全存储（已实现）**：`platform.secrets` 基于 Electron `safeStorage`（Windows DPAPI 等）加密落盘；规范要求插件保存密码走它、禁止明文存 `localStorage`/`storage`。
- **脱敏（强制）**：主进程对 `password`/URI 口令段在任何日志/错误/IPC 回传前 `***` 脱敏（已实现）；失败响应只回 `code`+通用 message，不透传含连接串的原始驱动消息。

---

## 3. `platform.net`：通用 TCP/TLS 字节管道（底座 · 已实现）

```ts
connect(opts: { host, port, tls?:boolean|{servername?,rejectUnauthorized?}, timeoutMs? }): Promise<{ok, socketId?, code?, error?}>
write(socketId, data: Uint8Array): Promise<{ok, backpressure?}>
close(socketId): Promise<{ok}>
onData(socketId, cb)/onClose(socketId, cb)/onError(socketId, cb)/onDrain(socketId, cb): () => void  // 取消订阅
```
- 主进程 `net.connect`/`tls.connect` 建连，按 socketId 多路复用；data/close/error/drain 经 IPC 推回。
- `write` 接收 `Uint8Array`→`Buffer.from` 写入；`backpressure:true` 时插件等 `onDrain` 再续写。
- 复用 §2 envelope（生命周期/上限/owner 清理）。SDK `useNet()` 自动注入 pluginId、卸载/关闭时注销监听器并 close。
- 插件用它实现任意协议客户端（PG wire/MQTT/SMTP/自定义二进制…），**无需任何 SDK 改动**。

---

## 4. MySQL（`db.mysql.*`，mysql2 · 后续） ✅REV-2

采纳原草案，并以 mysql2 **`typeCast` 钩子集中归一化**，明确类型映射矩阵：

| 列类型 | 归一化目标 | 说明 |
| --- | --- | --- |
| `BIGINT`(大整数) | **字符串** | `supportBigNumbers+bigNumberStrings`；`|v|>2^53-1` 必为字符串 |
| `DECIMAL`/`NUMERIC` | **字符串** | 保精度 |
| `DATE/DATETIME/TIMESTAMP/TIME` | **字符串** | `dateStrings:true`；connect 固定 `timezone:'Z'` |
| `JSON` | **原始字符串** | 关闭 mysql2 默认 `JSON.parse`，避免格式/键序/大整数失真 |
| `BIT` | **字符串** | 不落成 Buffer |
| `GEOMETRY/POINT…` | **WKT 字符串** | 固定形态写进规范 |
| `SET`/`ENUM` | 字符串 | |
| `TINYINT(1)` | **number(0/1)** | 不擅自转 boolean |
| `BLOB/BINARY/VARBINARY` | `Uint8Array` | 单值受 §2.5 上限 |

API：`connect(config)→{ok,connId,serverVersion}`；`query(connId,sql,params?)→{ok,durationMs,result:{kind:'rows'|'ok', rows?,fields?,affectedRows?,insertId?(字符串),changedRows?,truncated?}}`；`close`；`ping`。一次一条语句；`params` 走 `?` 参数化。

---

## 5. Redis（`db.redis.*`，ioredis，**RESP2** · 后续） ✅REV-1/3/5/13/20

> **关键修正**：ioredis ^5 **不支持 RESP3**。本规范**按 RESP2** 设计，删除 RESP3 map/set 原生归一化的假设。

```ts
connect(config): Promise<ConnectResponse>   // {host,port,username?,password?,db?,tls?,connectTimeoutMs?}
command(connId, args: (string|number|Uint8Array)[], opts?: { binary?: boolean }): Promise<RedisCommandResponse>
pipeline(connId, cmds): Promise<RedisPipelineResponse>
close(connId) / ping(connId)
```
- **命令下发**：`args[0]` 为命令名，执行 `redis.call(args[0], ...rest)`（默认）或 `redis.callBuffer(...)`（`binary:true`）。下发前把 `Uint8Array` 显式 `Buffer.from`。`args` 空或 `args[0]` 非字符串 → `BAD_ARGS`。
- **二进制（核心修正）**：`redis.call` 默认 UTF-8 解码会**不可逆损坏**二进制值。`binary:true` 走 `callBuffer`，bulk 回复返 `Buffer→Uint8Array`。建议键浏览器对值默认 `binary:true`、元信息命令用文本模式。
- **归一化 reply**：文本模式 `string|number|null|RedisReply[]`；二进制 → `Uint8Array`；错误 → `{_t:'error',message}`；整数 `|v|>2^53-1` → 字符串。**RESP2 下 `HGETALL`/`CONFIG GET` 等返回扁平数组**（非 map），可启用 ioredis reply transformer 或由插件按命令语义配对；规范**不假装统一标记 map**。顶层含 `durationMs`。
- Pub/Sub、阻塞命令 v1 不覆盖（需事件桥，后续 additive）。

---

## 6. MongoDB（`db.mongo.*`，mongodb v6 + EJSON · 后续） ✅REV-10/14

`connId → 一个 MongoClient`（驱动内部连接池）。全程 EJSON canonical，入参仅接受 plain extended-JSON（§2.4）。

```ts
connect(config) / listDatabases(connId) / listCollections(connId, db)
find(connId, db, coll, opts)              // 落地 coll.find(filter, optionsWithoutFilter)
countDocuments / aggregate(透传 opts) / distinct(connId, db, coll, field, filter?, options?)
insertOne/insertMany / updateOne/updateMany/replaceOne / deleteOne/deleteMany
listIndexes / createIndex → {ok, name:string}（透传索引名） / dropIndex
runCommand(connId, db, command)           // 逃生口
close(connId) / ping(connId)              // ping 走 admin().ping()
```
- **EJSON 保真边界（不夸大）**：`ObjectId/Date/Long/Decimal128/Binary/Timestamp/RegExp` canonical 无损；**需注意**：`double` 的 `NaN/Infinity/-0`、`undefined`、`Code-with-scope`、`Binary subType`（UUID=subtype4）等易失真，§6 列出白名单。
- `find`/`aggregate` 受 §2.5 字节封顶。

---

## 7. 类型单一来源 + 插件侧 ✅REV-11（已落实）

- **`@maoyugames/ttool-sdk` 为类型唯一权威来源**；`src/platform/types.ts` 为实现，`vite-env.d.ts` 用 `import('./platform/types')` 直接引用（不再手抄），插件离线 shim 标注「镜像自 SDK」。
- **`pluginId` 注入**：SDK hooks 调用时自动带当前插件 id（用于 per-plugin 计数 + 命名空间）；插件无感。
- **自动清理**：`useNet`/`useStorage`/`useSecrets`；`useNet` 卸载/关闭/远端关闭时注销监听器并 close。
- `platform.net?`/`storage?`/`secrets?`/`db?` 经 `platform` 自动透出。

---

## 8. 依赖（db 阶段）

`package.json` dependencies 增加（纯 JS，仅主进程 require）：`mysql2@^3.11.0`、`ioredis@^5.4.0`、`mongodb@^6.8.0`。`net`/`tls` 为 Node 内置（net 层无需额外依赖）。某 adapter `require` 失败则对应 `db.<kind>` 不挂载，其余正常；`net` 始终可用。

---

## 9. 文件改动清单

| 文件 | 改动 | 状态 |
| --- | --- | --- |
| `electron/host/registry.cjs` | 共享注册表+生命周期(reserve/release+busy/idleEvictable+owner+上限) | ✅ |
| `electron/host/net.cjs` | net/tls 多路复用 | ✅ |
| `electron/host/storage.cjs` / `secrets.cjs` / `jsonstore.cjs` | 命名空间 KV / safeStorage 加密 / 串行原子写 | ✅ |
| `electron/host/util.cjs` / `index.cjs` | safePluginId+redact / setupHost 编排 | ✅ |
| `electron/main.cjs` / `preload.cjs` | 接线 + 暴露 net/storage/secrets | ✅ |
| `src/platform/types.ts` / `electron.ts` / `vite-env.d.ts` | 类型 + 适配 | ✅ |
| `src/sdk/index.ts` / `App.tsx` / `packages/sdk` | PluginContext + net/storage/secrets hooks，bump 1.2.0 | ✅ |
| `src/platform/types.ts` / `packages/sdk` / `src/sdk` | **db 契约**(DbApi/MySQLApi/RedisApi/MongoApi + Platform.db?) + `useMySQL/useRedis/useMongo`，bump 1.3.0 | ✅ 契约先行 |
| `electron/host/mysql.cjs` / `redis.cjs` / `mongo.cjs` + preload/electron 接 `platform.db` | 三 DB 适配器 + `db:*` IPC 接线 | ⬜ 后续（运行时） |

---

## 10. 向下兼容

全 **additive**：`platform.net?`/`storage?`/`secrets?`/`db?` 新增，既有插件零影响，`manifest.sdk` 仍 `"1"`。
- net/storage/secrets 表面 → **已发布 `@maoyugames/ttool-sdk` 1.2.0**。
- db 的 SDK 契约（`platform.db.{mysql,redis,mongo}` + `useMySQL/useRedis/useMongo`）→ **已发布 1.3.0（契约先行）**：插件可即按契约开发；**运行时需宿主适配器**（`electron/host/{mysql,redis,mongo}.cjs` + preload/electron 接线，本仓后续实现），未接入前 `platform.db` 为 undefined、hooks 降级（`available=false` / 返回 `NO_DB`）。
- 后续 db 适配器落地仅为「接通运行时」，不改既有 SDK 签名；新协议走 net 无需改 SDK。

---

## 11. 实施顺序

1. ✅ **共享 envelope + `net.cjs` + storage/secrets** —— 底座先行。
2. ⬜ **MySQL 适配器**（typeCast 矩阵）—— 与现有 MySQL 插件联调。
3. ⬜ **Redis 适配器**（RESP2 + callBuffer 二进制）。
4. ⬜ **MongoDB 适配器**（EJSON）。
5. 每步：补 platform/preload/SDK 类型（SDK 为唯一来源）→ 重建 → 真连库验收 → 同步插件指南 → bump SDK 版本发布。
6. 新增数据库（PG/SQLite/MSSQL…）按同模式加 `db.<kind>.*`；冷门协议直接用 `net`，零 SDK 改动。
