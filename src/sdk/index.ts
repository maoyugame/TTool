// 宿主 SDK：外部插件在运行时通过全局复用宿主的这一份实例（React / SDK），
// 保证整个应用只有一份 React（hooks/context 才正常）。
//
// 外部工具用正常的 `import` 写代码：
//   import React from 'react'
//   import { registerTool, ToolPage, ToolHeader, usePersistentState, useToolbox } from '@maoyugames/ttool-sdk'
// 其构建（见脚手架模板）把 react / react-dom / react/jsx-runtime / @maoyugames/ttool-sdk 标为 external，
// 分别映射到下面 installSdkGlobals() 注入的全局，从而复用宿主实例。
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import { registerTool } from '../tools/registry'
import { ToolPage, ToolHeader, Panel, Seg, ActionPill, MONO, labelStyle } from '../tools/ui'
import { HUE, iconBg, iconShadow, headerIconShadow } from '../tools/hue'
import { ToolIcon } from '../components/ToolIcon'
import { usePersistentState } from '../store/persistentState'
import { useToolbox } from '../store/toolbox'
import { useNow } from '../store/useNow'
import { platform } from '../platform'
import type { MySQLConnectConfig, RedisConnectConfig, MongoConnectConfig } from '../platform/types'

// SDK 版本：与插件 manifest.sdk 做兼容校验用（主版本）。
export const SDK_VERSION = '1'

// 插件命名空间上下文：宿主在渲染每个工具时用 <PluginContext.Provider value={工具id}> 包裹，
// 下面的 useStorage / useSecrets / useNet 据此自动注入 pluginId，插件无需自己传 id。
// 注意：单 webContents 下这是「命名空间」（防键碰撞 / 误读），非对恶意插件的硬隔离（受信任模型）。
export const PluginContext = React.createContext<string>('')
const usePluginId = (): string => React.useContext(PluginContext) || ''

// 按插件命名空间的持久化 KV（普通数据：笔记 / 配置 / 收藏）。仅桌面可用。
export function useStorage() {
  const pid = usePluginId()
  return React.useMemo(
    () => ({
      get available() {
        return !!platform.storage
      },
      async get<T = unknown>(key: string, fallback?: T): Promise<T | undefined> {
        const r = await platform.storage?.get<T>(pid, key)
        if (!r || !r.ok || r.value === undefined) return fallback
        return r.value
      },
      async set(key: string, value: unknown): Promise<boolean> {
        const r = await platform.storage?.set(pid, key, value)
        return !!(r && r.ok)
      },
      async remove(key: string): Promise<boolean> {
        const r = await platform.storage?.delete(pid, key)
        return !!(r && r.ok)
      },
      async keys(): Promise<string[]> {
        const r = await platform.storage?.keys(pid)
        return (r && r.keys) || []
      },
    }),
    [pid]
  )
}

// safeStorage 加密凭证存储（秘钥 / 密码 / 账号 token）。仅桌面可用。
export function useSecrets() {
  const pid = usePluginId()
  return React.useMemo(
    () => ({
      async available(): Promise<boolean> {
        const r = await platform.secrets?.available()
        return !!(r && r.available)
      },
      async get(key: string): Promise<string | undefined> {
        const r = await platform.secrets?.get(pid, key)
        return r && r.ok ? r.value : undefined
      },
      async set(key: string, value: string): Promise<boolean> {
        const r = await platform.secrets?.set(pid, key, value)
        return !!(r && r.ok)
      },
      async remove(key: string): Promise<boolean> {
        const r = await platform.secrets?.delete(pid, key)
        return !!(r && r.ok)
      },
      async keys(): Promise<string[]> {
        const r = await platform.secrets?.keys(pid)
        return (r && r.keys) || []
      },
    }),
    [pid]
  )
}

// 通用 TCP/TLS 字节管道。仅桌面可用。
// 组件卸载 / 显式 close / 远端关闭时，自动注销该 socket 的全部 IPC 监听器并关闭连接，
// 避免渲染层 ipcRenderer 监听器随短连接累积泄漏。
export function useNet() {
  const pid = usePluginId()
  // socketId -> 该 socket 注册的取消订阅集合
  const subs = React.useRef<Map<string, Set<() => void>>>(new Map())
  const purge = React.useCallback((socketId: string) => {
    const set = subs.current.get(socketId)
    if (set) {
      for (const off of set) {
        try {
          off()
        } catch {
          /* ignore */
        }
      }
      subs.current.delete(socketId)
    }
  }, [])
  React.useEffect(
    () => () => {
      for (const id of Array.from(subs.current.keys())) {
        purge(id)
        platform.net?.close(id)
      }
      subs.current.clear()
    },
    [purge]
  )
  return React.useMemo(() => {
    const track = (socketId: string, off?: () => void): (() => void) => {
      if (!off) return () => {}
      let set = subs.current.get(socketId)
      if (!set) {
        set = new Set()
        subs.current.set(socketId, set)
      }
      set.add(off)
      return () => {
        set!.delete(off)
        try {
          off()
        } catch {
          /* ignore */
        }
      }
    }
    return {
      get available() {
        return !!platform.net
      },
      async connect(opts: { host: string; port: number; tls?: boolean | { servername?: string; rejectUnauthorized?: boolean }; timeoutMs?: number }) {
        const r = await platform.net?.connect({ ...opts, pluginId: pid })
        if (r && r.ok && r.socketId) {
          const id = r.socketId
          if (!subs.current.has(id)) subs.current.set(id, new Set())
          // 远端关闭时自动清理该 socket 的全部监听器（延后到本轮事件回调跑完，
          // 确保插件自己的 onClose 回调仍能先收到关闭事件）。
          const offClose = platform.net?.onClose(id, () => {
            Promise.resolve().then(() => purge(id))
          })
          if (offClose) subs.current.get(id)!.add(offClose)
        }
        return r ?? { ok: false as const, code: 'NO_NET', error: '当前运行时不支持网络能力（仅桌面版）' }
      },
      write(socketId: string, data: Uint8Array) {
        return platform.net?.write(socketId, data) ?? Promise.resolve({ ok: false })
      },
      close(socketId: string) {
        purge(socketId)
        return platform.net?.close(socketId) ?? Promise.resolve({ ok: false })
      },
      onData(socketId: string, cb: (chunk: Uint8Array) => void) {
        return track(socketId, platform.net?.onData(socketId, cb))
      },
      onClose(socketId: string, cb: (info: { hadError: boolean }) => void) {
        return track(socketId, platform.net?.onClose(socketId, cb))
      },
      onError(socketId: string, cb: (err: { error: string; code?: string }) => void) {
        return track(socketId, platform.net?.onError(socketId, cb))
      },
      onDrain(socketId: string, cb: () => void) {
        return track(socketId, platform.net?.onDrain(socketId, cb))
      },
    }
  }, [pid, purge])
}

// ---- 数据库便利层 hooks（自 SDK 1.3.0）----
// 契约先行：运行时需宿主已实现对应 DB 适配器（electron/host/{mysql,redis,mongo}.cjs，规划中）。
// 未接入时 platform.db 为 undefined → available=false、connect/close 返回 NO_DB（插件应先判 available）。
const NODB = { ok: false as const, code: 'NO_DB' as const, error: '当前运行时不支持数据库能力（仅桌面版，且需宿主已实现对应适配器）' }

// 通用：connect 注入 pluginId、跟踪 connId、组件卸载时自动关闭本 hook 打开的连接。
function useDbConns() {
  const opened = React.useRef<Set<string>>(new Set())
  return opened
}

export function useMySQL() {
  const pid = usePluginId()
  const opened = useDbConns()
  React.useEffect(
    () => () => {
      const a = platform.db?.mysql
      if (a) for (const id of opened.current) a.close(id)
      opened.current.clear()
    },
    [opened]
  )
  return React.useMemo(() => {
    const a = platform.db?.mysql
    const base = {
      get available() {
        return !!a
      },
      async connect(config: MySQLConnectConfig) {
        if (!a) return NODB
        const r = await a.connect({ ...config, pluginId: pid })
        if (r && r.ok && r.connId) opened.current.add(r.connId)
        return r
      },
      close(connId: string) {
        opened.current.delete(connId)
        return a ? a.close(connId) : Promise.resolve(NODB)
      },
    }
    return a ? { ...a, ...base } : base
  }, [pid, opened])
}

export function useRedis() {
  const pid = usePluginId()
  const opened = useDbConns()
  React.useEffect(
    () => () => {
      const a = platform.db?.redis
      if (a) for (const id of opened.current) a.close(id)
      opened.current.clear()
    },
    [opened]
  )
  return React.useMemo(() => {
    const a = platform.db?.redis
    const base = {
      get available() {
        return !!a
      },
      async connect(config: RedisConnectConfig) {
        if (!a) return NODB
        const r = await a.connect({ ...config, pluginId: pid })
        if (r && r.ok && r.connId) opened.current.add(r.connId)
        return r
      },
      close(connId: string) {
        opened.current.delete(connId)
        return a ? a.close(connId) : Promise.resolve(NODB)
      },
    }
    return a ? { ...a, ...base } : base
  }, [pid, opened])
}

export function useMongo() {
  const pid = usePluginId()
  const opened = useDbConns()
  React.useEffect(
    () => () => {
      const a = platform.db?.mongo
      if (a) for (const id of opened.current) a.close(id)
      opened.current.clear()
    },
    [opened]
  )
  return React.useMemo(() => {
    const a = platform.db?.mongo
    const base = {
      get available() {
        return !!a
      },
      async connect(config: MongoConnectConfig) {
        if (!a) return NODB
        const r = await a.connect({ ...config, pluginId: pid })
        if (r && r.ok && r.connId) opened.current.add(r.connId)
        return r
      },
      close(connId: string) {
        opened.current.delete(connId)
        return a ? a.close(connId) : Promise.resolve(NODB)
      },
    }
    return a ? { ...a, ...base } : base
  }, [pid, opened])
}

// 暴露给外部插件的 SDK 表面。保持稳定，新增只增不改。
export const TToolSDK = {
  version: SDK_VERSION,
  // 注册
  registerTool,
  defineTool: registerTool, // 别名，语义更直观
  // UI 原语
  ToolPage,
  ToolHeader,
  Panel,
  Seg,
  ActionPill,
  ToolIcon,
  MONO,
  labelStyle,
  // hooks
  usePersistentState,
  useToolbox,
  useNow,
  // 数据 / 网络能力 hooks（按插件命名空间，仅桌面；web 下优雅降级）
  useStorage,
  useSecrets,
  useNet,
  // 数据库便利层 hooks（自 1.3.0；运行时需宿主适配器，未接入时降级）
  useMySQL,
  useRedis,
  useMongo,
  // 平台能力（剪贴板 / 打开应用 / 翻译 / net / storage / secrets，已跨运行时降级）
  platform,
  // 配色
  HUE,
  iconBg,
  iconShadow,
  headerIconShadow,
}

export type TToolSDKType = typeof TToolSDK

declare global {
  interface Window {
    React?: typeof React
    ReactDOM?: typeof ReactDOM
    ReactJsxRuntime?: typeof ReactJsxRuntime
    TToolSDK?: TToolSDKType
  }
}

// 在应用启动、加载任何插件之前调用，注入共享单例。
export function installSdkGlobals(): void {
  window.React = React
  window.ReactDOM = ReactDOM
  window.ReactJsxRuntime = ReactJsxRuntime
  window.TToolSDK = TToolSDK
}
