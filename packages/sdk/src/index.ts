// @maoyugames/ttool-sdk —— 工具插件开发 SDK。
//
// 工具作者按正常方式 import 本包；构建时（见脚手架模板的 vite.config）把
// 'react' / 'react-dom' / 'react/jsx-runtime' / '@maoyugames/ttool-sdk' 标为 external，
// 分别映射到宿主注入的全局（React / ReactDOM / ReactJsxRuntime / TToolSDK），
// 从而运行时复用宿主的同一份 React 与 SDK 实例（保证只有一份 React，hooks/context 正常）。
//
// 本文件同时充当：① 开发期类型来源；② 未被外置时的运行期兜底（从全局取值）。
import type { ComponentType, ReactNode, CSSProperties } from 'react'

export type HueName = 'blue' | 'purple' | 'amber' | 'teal' | 'green' | 'indigo' | 'pink' | 'gray'

export interface ToolSpec {
  /** 全局唯一 id（与 manifest.id 一致） */
  id: string
  name: string
  desc: string
  /** 无图标图片时显示的字形 */
  glyph: string
  /** 图标图片 URL（可选） */
  icon?: string
  /** 分类（任意字符串；空分类自动隐藏） */
  cat: string
  hue: HueName
  /** 展示排序，越小越靠前 */
  order?: number
  /** 搜索补充词（拼音/英文别名） */
  keywords?: string
  /** 工具主体组件 */
  component: ComponentType
}

interface SDK {
  registerTool(spec: ToolSpec): void
  defineTool(spec: ToolSpec): void
  ToolPage: ComponentType<{ scroll?: boolean; children?: ReactNode }>
  ToolHeader: ComponentType<{ glyph: string; icon?: string; hue: HueName; glyphSize?: number; glyphWeight?: number; title: string; subtitle?: ReactNode; right?: ReactNode; mb?: number }>
  Panel: ComponentType<{ label: ReactNode; right?: ReactNode; children?: ReactNode; flex?: boolean }>
  Seg: ComponentType<{ options: { key: string; label: string }[]; value: string; onChange: (k: string) => void }>
  ActionPill: ComponentType<{ onClick: () => void; primary?: boolean; children?: ReactNode }>
  ToolIcon: ComponentType<{ icon?: string; glyph: string; hue: HueName; size: number; radius: number; glyphSize: number; glyphWeight?: number; shadow?: 'list' | 'header' | 'none' }>
  MONO: string
  labelStyle: CSSProperties
  usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void]
  useToolbox(): { copy(text: string, label?: string): void; flash(msg: string): void; openTool(id: string): void }
  useNow(): number
  /** 按插件命名空间的持久化 KV（普通数据：笔记 / 配置 / 收藏）。仅桌面，web 下各方法降级为 no-op/默认值。 */
  useStorage(): StorageHook
  /** safeStorage 加密凭证存储（秘钥 / 密码 / 账号）。仅桌面。 */
  useSecrets(): SecretsHook
  /** 通用 TCP/TLS 字节管道。仅桌面；卸载时自动关闭本 hook 打开的 socket。 */
  useNet(): NetHook
  platform: {
    readonly kind: 'web' | 'electron' | 'tauri'
    readonly isDesktop: boolean
    copyText(text: string): Promise<void>
    openExternalApp(path: string): Promise<{ ok: boolean; error?: string }>
    translate?(text: string, from: string, to: string): Promise<string>
    net?: NetApi
    storage?: StorageApi
    secrets?: SecretsApi
  }
}

// ---- 网络 / 存储 / 凭证：类型与 hook 形态 ----
export interface NetConnectOptions {
  host: string
  port: number
  tls?: boolean | { servername?: string; rejectUnauthorized?: boolean }
  timeoutMs?: number
}
export interface NetConnectResult { ok: boolean; socketId?: string; code?: string; error?: string }
export interface NetWriteResult { ok: boolean; backpressure?: boolean; code?: string; error?: string }
export interface NetApi {
  connect(opts: NetConnectOptions & { pluginId?: string }): Promise<NetConnectResult>
  write(socketId: string, data: Uint8Array): Promise<NetWriteResult>
  close(socketId: string): Promise<{ ok: boolean }>
  onData(socketId: string, cb: (chunk: Uint8Array) => void): () => void
  onClose(socketId: string, cb: (info: { hadError: boolean }) => void): () => void
  onError(socketId: string, cb: (err: { error: string; code?: string }) => void): () => void
  onDrain(socketId: string, cb: () => void): () => void
}
export interface StorageResult<T = unknown> { ok: boolean; value?: T; keys?: string[]; code?: string; error?: string }
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
export interface StorageHook {
  readonly available: boolean
  get<T = unknown>(key: string, fallback?: T): Promise<T | undefined>
  set(key: string, value: unknown): Promise<boolean>
  remove(key: string): Promise<boolean>
  keys(): Promise<string[]>
}
export interface SecretsHook {
  available(): Promise<boolean>
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<boolean>
  remove(key: string): Promise<boolean>
  keys(): Promise<string[]>
}
export interface NetHook {
  readonly available: boolean
  connect(opts: NetConnectOptions): Promise<NetConnectResult>
  write(socketId: string, data: Uint8Array): Promise<NetWriteResult>
  close(socketId: string): Promise<{ ok: boolean }>
  onData(socketId: string, cb: (chunk: Uint8Array) => void): () => void
  onClose(socketId: string, cb: (info: { hadError: boolean }) => void): () => void
  onError(socketId: string, cb: (err: { error: string; code?: string }) => void): () => void
  onDrain(socketId: string, cb: () => void): () => void
}

const sdk = (globalThis as unknown as { TToolSDK?: SDK }).TToolSDK
if (!sdk) {
  throw new Error('@maoyugames/ttool-sdk：宿主未注入 TToolSDK。本插件需在「TTool」平台内由宿主加载运行。')
}

export const registerTool = sdk.registerTool
export const defineTool = sdk.defineTool
export const ToolPage = sdk.ToolPage
export const ToolHeader = sdk.ToolHeader
export const Panel = sdk.Panel
export const Seg = sdk.Seg
export const ActionPill = sdk.ActionPill
export const ToolIcon = sdk.ToolIcon
export const MONO = sdk.MONO
export const labelStyle = sdk.labelStyle
export const usePersistentState = sdk.usePersistentState
export const useToolbox = sdk.useToolbox
export const useNow = sdk.useNow
export const useStorage = sdk.useStorage
export const useSecrets = sdk.useSecrets
export const useNet = sdk.useNet
export const platform = sdk.platform
