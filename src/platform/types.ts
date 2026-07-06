// 平台适配层接口 —— "做好兼容"的核心之一。
//
// 业务/工具代码只依赖这个抽象接口，从不直接调用 Electron / Tauri / 浏览器 API。
// 这样同一套核心应用可以在以下环境无改动运行：
//   - web   ：纯浏览器（默认，开箱即用，便于开发与验证）
//   - electron：桌面壳（原生剪贴板、打开第三方应用、文件选择、窗口控制）
//   - tauri ：未来可新增一个适配器实现本接口即可，核心代码零改动
import type { PluginManifest } from '../tools/types'

export interface AppOpenResult {
  ok: boolean
  error?: string
}

export interface PickAppResult {
  canceled: boolean
  path?: string
}

export type PluginSource =
  | { type: 'github'; repo: string; tag: string | null }
  | { type: 'local'; path: string }
  | { type: 'local-link'; path: string }
  | null

export interface InstalledPlugin {
  manifest: PluginManifest
  enabled: boolean
  source: PluginSource
}

export interface InstallResult {
  ok?: boolean
  canceled?: boolean
  id?: string
  manifest?: PluginManifest
  error?: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenshotShortcutConfig {
  enabled: boolean
  screenshot: string
  screenshotPin: string
}

export type ScreenshotShortcutKey = 'screenshot' | 'screenshotPin'

export interface ScreenshotShortcutStatus {
  key: ScreenshotShortcutKey
  accelerator: string
  registered: boolean
  error?: string
}

export interface ScreenshotConfigResult {
  ok: boolean
  config: ScreenshotShortcutConfig
  statuses: ScreenshotShortcutStatus[]
  error?: string
}

export type ScreenshotPermissionStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

export interface ScreenshotDisplayInfo {
  id: number
  bounds: Rect
  workArea: Rect
  scaleFactor: number
  primary: boolean
}

export interface ScreenshotEnvironment {
  isDesktop: boolean
  platform: string
  permission: ScreenshotPermissionStatus
  displays: ScreenshotDisplayInfo[]
}

export type ScreenshotCaptureSource = 'screenshot' | 'pin-annotate'

export interface ScreenshotCapture {
  id: string
  source: ScreenshotCaptureSource
  imageDataUrl: string
  width: number
  height: number
  createdAt: number
  displayId?: number
  pinId?: string
}

export interface ScreenshotRecentItem {
  id: string
  imageDataUrl: string
  createdAt: number
  width: number
  height: number
  displayId?: number
}

export interface ScreenshotPinInfo {
  id: string
  imageDataUrl: string
  createdAt: number
  width: number
  height: number
  visible: boolean
  displayId?: number
  opacity?: number
}

export interface ScreenshotPinOptions {
  displayId?: number
  sourceRect?: Rect
}

export interface ScreenshotRememberOptions {
  displayId?: number
}

export interface ImageSaveResult {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

export interface SimpleResult {
  ok: boolean
  error?: string
}

export interface ScreenshotStatusEvent {
  level: 'info' | 'error'
  message: string
}

export interface ScreenshotApi {
  getEnvironment(): Promise<ScreenshotEnvironment>
  getConfig(): Promise<ScreenshotConfigResult>
  setConfig(config: ScreenshotShortcutConfig): Promise<ScreenshotConfigResult>
  startCapture(action: 'edit' | 'pin'): Promise<SimpleResult>
  consumeCaptures(): Promise<ScreenshotCapture[]>
  ackCapture(id: string): Promise<SimpleResult>
  onCapture(cb: (capture: ScreenshotCapture) => void): () => void
  onStatus(cb: (status: ScreenshotStatusEvent) => void): () => void
  listRecentScreenshots(): Promise<ScreenshotRecentItem[]>
  rememberScreenshot(dataUrl: string, options?: ScreenshotRememberOptions): Promise<SimpleResult & { item?: ScreenshotRecentItem }>
  deleteRecentScreenshot(id: string): Promise<SimpleResult>
  onRecentScreenshotsChanged(cb: (items: ScreenshotRecentItem[]) => void): () => void
  copyImage(dataUrl: string): Promise<SimpleResult>
  saveImage(dataUrl: string, suggestedName?: string): Promise<ImageSaveResult>
  listPins(): Promise<ScreenshotPinInfo[]>
  createPin(dataUrl: string, options?: ScreenshotPinOptions): Promise<SimpleResult & { pin?: ScreenshotPinInfo }>
  updatePin(id: string, dataUrl: string): Promise<SimpleResult & { pin?: ScreenshotPinInfo }>
  focusPin(id: string): Promise<SimpleResult>
  setPinVisible(id: string, visible: boolean): Promise<SimpleResult>
  closePin(id: string): Promise<SimpleResult>
  closeAllPins(): Promise<SimpleResult>
  annotatePin(id: string): Promise<SimpleResult>
  onPinsChanged(cb: (pins: ScreenshotPinInfo[]) => void): () => void
}

// 插件管理能力（仅桌面）。
export interface PluginApi {
  list(): Promise<InstalledPlugin[]>
  installGithub(repo: string, tag?: string): Promise<InstallResult>
  installLocal(): Promise<InstallResult>
  /** 开发者链接：直接从外部 dist 目录加载，改代码重新构建+重载即生效（不复制） */
  installLocalLink(): Promise<InstallResult>
  remove(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  update(id: string): Promise<InstallResult>
  readBundle(id: string): Promise<string>
}

// ---- 通用网络（TCP/TLS 字节管道，仅桌面） ----
export interface NetConnectOptions {
  host: string
  port: number
  /** true=默认 TLS；对象可指定 servername / 是否校验证书（自签可设 rejectUnauthorized:false） */
  tls?: boolean | { servername?: string; rejectUnauthorized?: boolean }
  timeoutMs?: number
  /** 由 SDK hook 自动注入，用于按插件计连接数 */
  pluginId?: string
}
export interface NetConnectResult {
  ok: boolean
  socketId?: string
  code?: string
  error?: string
}
export interface NetWriteResult {
  ok: boolean
  /** true 表示内核写缓冲已满，应等 onDrain 再续写 */
  backpressure?: boolean
  code?: string
  error?: string
}
export interface NetApi {
  connect(opts: NetConnectOptions): Promise<NetConnectResult>
  write(socketId: string, data: Uint8Array): Promise<NetWriteResult>
  close(socketId: string): Promise<{ ok: boolean }>
  onData(socketId: string, cb: (chunk: Uint8Array) => void): () => void
  onClose(socketId: string, cb: (info: { hadError: boolean }) => void): () => void
  onError(socketId: string, cb: (err: { error: string; code?: string }) => void): () => void
  onDrain(socketId: string, cb: () => void): () => void
}

// ---- 持久化存储 / 加密凭证（按 pluginId 命名空间，仅桌面） ----
export interface StorageResult<T = unknown> {
  ok: boolean
  value?: T
  keys?: string[]
  code?: string
  error?: string
}
export interface StorageApi {
  get<T = unknown>(pluginId: string, key: string): Promise<StorageResult<T>>
  set(pluginId: string, key: string, value: unknown): Promise<StorageResult>
  delete(pluginId: string, key: string): Promise<StorageResult>
  keys(pluginId: string): Promise<StorageResult>
}
export interface SecretsApi {
  available(): Promise<{ ok: boolean; available: boolean }>
  get(pluginId: string, key: string): Promise<StorageResult<string>>
  set(pluginId: string, key: string, value: string): Promise<StorageResult>
  delete(pluginId: string, key: string): Promise<StorageResult>
  keys(pluginId: string): Promise<StorageResult>
}

// ---- 数据库便利层（platform.db，仅桌面；契约自 SDK 1.3.0 起提供）----
// 注意：运行时需宿主已实现对应 DB 适配器（electron/host/{mysql,redis,mongo}.cjs，规划中）。
// 未接入前 platform.db 为 undefined，SDK 的 db hooks 降级（available=false / 调用返回 NO_DB）。
// 详尽语义（类型映射 / 错误码 / 序列化 / 体量封顶）见 HOST-DB-SPEC.md。
export type DbCode =
  | 'AUTH_FAILED' | 'CONN_REFUSED' | 'TIMEOUT' | 'DNS_FAIL' | 'TLS_FAIL'
  | 'NO_CONN' | 'STALE_CONN' | 'TOO_MANY_CONNS' | 'BAD_ARGS'
  | 'DUP_KEY' | 'SYNTAX_ERR' | 'EJSON_INVALID' | 'RESULT_TRUNCATED'
  | 'NO_DB' | 'UNKNOWN'

/** 建连结果：成功返回不透明 connId（+ 可选 serverVersion）。 */
export interface DbConnectResult { ok: boolean; connId?: string; serverVersion?: string; code?: DbCode; error?: string }
/** 简单结果（close / ping / dropIndex 等）。 */
export interface DbSimpleResult { ok: boolean; code?: DbCode; error?: string }

// MySQL（mysql2；类型经 typeCast 矩阵归一化，大整数/DECIMAL/DATE/JSON 等以字符串保真）
export interface MySQLConnectConfig { host: string; port?: number; user?: string; password?: string; database?: string; ssl?: boolean | { rejectUnauthorized?: boolean }; connectTimeoutMs?: number; pluginId?: string }
export interface MySQLField { name: string; type?: string }
export interface MySQLQueryResult {
  ok: boolean
  durationMs?: number
  result?: { kind: 'rows' | 'ok'; rows?: Record<string, unknown>[]; fields?: MySQLField[]; affectedRows?: number; insertId?: string; changedRows?: number; truncated?: boolean }
  code?: DbCode; error?: string; driverCode?: string; errno?: number
}
export interface MySQLApi {
  connect(config: MySQLConnectConfig): Promise<DbConnectResult>
  /** 一次一条语句；params 走 ? 参数化防注入。 */
  query(connId: string, sql: string, params?: unknown[]): Promise<MySQLQueryResult>
  close(connId: string): Promise<DbSimpleResult>
  ping(connId: string): Promise<DbSimpleResult>
}

// Redis（ioredis，RESP2；二进制值用 opts.binary 走 callBuffer 返回 Uint8Array）
export type RedisReply = string | number | null | Uint8Array | RedisReply[] | { _t: 'error'; message: string }
export interface RedisConnectConfig { host: string; port?: number; username?: string; password?: string; db?: number; tls?: boolean | { rejectUnauthorized?: boolean }; connectTimeoutMs?: number; pluginId?: string }
export interface RedisCommandResult { ok: boolean; durationMs?: number; reply?: RedisReply; code?: DbCode; error?: string; driverCode?: string }
export interface RedisCommandSpec { args: (string | number | Uint8Array)[]; binary?: boolean }
export interface RedisPipelineResult { ok: boolean; durationMs?: number; replies?: RedisReply[]; code?: DbCode; error?: string }
export interface RedisApi {
  connect(config: RedisConnectConfig): Promise<DbConnectResult>
  /** args[0] 为命令名；opts.binary=true 时回复按二进制（Uint8Array）返回，避免 UTF-8 破坏。 */
  command(connId: string, args: (string | number | Uint8Array)[], opts?: { binary?: boolean }): Promise<RedisCommandResult>
  pipeline(connId: string, cmds: RedisCommandSpec[]): Promise<RedisPipelineResult>
  close(connId: string): Promise<DbSimpleResult>
  ping(connId: string): Promise<DbSimpleResult>
}

// MongoDB（mongodb v6；值用 Extended JSON canonical 的 plain object 表示，如 {$oid}/{$date}）
export type EJSON = unknown
export interface MongoConnectConfig { uri?: string; host?: string; port?: number; user?: string; password?: string; authSource?: string; tls?: boolean; replicaSet?: string; connectTimeoutMs?: number; pluginId?: string }
export interface MongoFindOptions { filter?: EJSON; projection?: EJSON; sort?: EJSON; limit?: number; skip?: number }
export interface MongoDocsResult { ok: boolean; durationMs?: number; docs?: EJSON[]; truncated?: boolean; code?: DbCode; error?: string }
export interface MongoCountResult { ok: boolean; durationMs?: number; count?: number; code?: DbCode; error?: string }
export interface MongoNamesResult { ok: boolean; durationMs?: number; names?: string[]; code?: DbCode; error?: string }
export interface MongoWriteResult { ok: boolean; durationMs?: number; insertedId?: EJSON; insertedIds?: EJSON[]; matchedCount?: number; modifiedCount?: number; upsertedId?: EJSON; deletedCount?: number; code?: DbCode; error?: string }
export interface MongoIndexResult { ok: boolean; name?: string; code?: DbCode; error?: string }
export interface MongoRunCommandResult { ok: boolean; durationMs?: number; result?: EJSON; code?: DbCode; error?: string }
export interface MongoApi {
  connect(config: MongoConnectConfig): Promise<DbConnectResult>
  listDatabases(connId: string): Promise<MongoNamesResult>
  listCollections(connId: string, db: string): Promise<MongoNamesResult>
  find(connId: string, db: string, coll: string, opts?: MongoFindOptions): Promise<MongoDocsResult>
  countDocuments(connId: string, db: string, coll: string, filter?: EJSON): Promise<MongoCountResult>
  aggregate(connId: string, db: string, coll: string, pipeline: EJSON[], opts?: EJSON): Promise<MongoDocsResult>
  distinct(connId: string, db: string, coll: string, field: string, filter?: EJSON, options?: EJSON): Promise<MongoDocsResult>
  insertOne(connId: string, db: string, coll: string, doc: EJSON): Promise<MongoWriteResult>
  insertMany(connId: string, db: string, coll: string, docs: EJSON[]): Promise<MongoWriteResult>
  updateOne(connId: string, db: string, coll: string, filter: EJSON, update: EJSON, opts?: EJSON): Promise<MongoWriteResult>
  updateMany(connId: string, db: string, coll: string, filter: EJSON, update: EJSON, opts?: EJSON): Promise<MongoWriteResult>
  replaceOne(connId: string, db: string, coll: string, filter: EJSON, replacement: EJSON, opts?: EJSON): Promise<MongoWriteResult>
  deleteOne(connId: string, db: string, coll: string, filter: EJSON): Promise<MongoWriteResult>
  deleteMany(connId: string, db: string, coll: string, filter: EJSON): Promise<MongoWriteResult>
  listIndexes(connId: string, db: string, coll: string): Promise<MongoDocsResult>
  createIndex(connId: string, db: string, coll: string, keys: EJSON, opts?: EJSON): Promise<MongoIndexResult>
  dropIndex(connId: string, db: string, coll: string, name: string): Promise<DbSimpleResult>
  runCommand(connId: string, db: string, command: EJSON): Promise<MongoRunCommandResult>
  close(connId: string): Promise<DbSimpleResult>
  ping(connId: string): Promise<DbSimpleResult>
}

export interface DbApi { mysql?: MySQLApi; redis?: RedisApi; mongo?: MongoApi }

export interface Platform {
  /** 运行时标识 */
  readonly kind: 'web' | 'electron' | 'tauri'

  /** 是否为桌面运行时（具备打开本地应用等能力） */
  readonly isDesktop: boolean

  /** 写入系统剪贴板 */
  copyText(text: string): Promise<void>

  /** 打开/启动一个第三方应用（仅桌面有意义） */
  openExternalApp(path: string): Promise<AppOpenResult>

  /** 弹出文件选择器选择应用路径（仅桌面有意义） */
  pickAppPath(): Promise<PickAppResult>

  /** 自定义标题栏窗口控制（仅桌面有意义；web 下为空操作） */
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
  }

  /**
   * 翻译能力。各适配器实现：web 直连免费 API，electron 走主进程免 CORS。
   * 返回译文；失败抛错。可替换为任意翻译服务（DeepL / 自建等）而不影响 UI。
   */
  translate?: (text: string, from: string, to: string) => Promise<string>

  /** 全局热键唤醒事件（仅桌面）。返回取消订阅函数。 */
  onSummon?: (cb: () => void) => () => void

  /** 窗口获得焦点事件（仅桌面）。返回取消订阅函数。 */
  onWindowFocus?: (cb: () => void) => () => void

  /** 插件管理（仅桌面；web 下为 undefined）。 */
  plugins?: PluginApi

  /** 通用 TCP/TLS 字节管道（仅桌面；web 下为 undefined）。 */
  net?: NetApi

  /** 按插件命名空间的持久化 KV（仅桌面；web 下为 undefined）。 */
  storage?: StorageApi

  /** safeStorage 加密凭证存储（仅桌面；web 下为 undefined）。 */
  secrets?: SecretsApi

  /** 数据库便利层（仅桌面，且需宿主已实现对应适配器；未接入时为 undefined）。 */
  db?: DbApi

  /** 当前窗口模式：主窗 'main' 或快速启动器小窗 'launcher'。web 下恒为 'main'。 */
  readonly mode: 'main' | 'launcher'

  /** 本机文件搜索（仅桌面，走 OS 系统索引，快）。web 下为 undefined。 */
  searchFiles?: (query: string) => Promise<FileHit[]>
  /** 深度扫描其它固定硬盘（Windows 上扫非 C 盘，较慢；mac/linux 已被 searchFiles 覆盖返回空）。 */
  searchFilesDeep?: (query: string) => Promise<FileHit[]>
  /** 用默认程序打开文件/文件夹（仅桌面）。 */
  openPath?: (path: string) => Promise<AppOpenResult>
  /** 在文件管理器中显示并选中该文件（仅桌面）。 */
  revealPath?: (path: string) => Promise<void>

  /** 快速启动器小窗路由（仅在 launcher 小窗内可用）。 */
  launcher?: LauncherApi

  /** 主窗订阅：启动器小窗请求打开某工具。返回取消订阅函数（仅桌面主窗）。 */
  onOpenTool?: (cb: (id: string) => void) => () => void
}

export interface FileHit {
  path: string
  name: string
}

export interface LauncherApi {
  /** 隐藏小窗 */
  hide(): void
  /** 在主窗口打开某工具（并隐藏小窗） */
  openTool(id: string): void
  /** 按内容高度调整小窗高度（保持顶部位置） */
  resize(height: number): void
}
