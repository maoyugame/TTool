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

export type PluginSource = { type: 'github'; repo: string; tag: string | null } | { type: 'local'; path: string } | null

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

// 插件管理能力（仅桌面）。
export interface PluginApi {
  list(): Promise<InstalledPlugin[]>
  installGithub(repo: string, tag?: string): Promise<InstallResult>
  installLocal(): Promise<InstallResult>
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
}
