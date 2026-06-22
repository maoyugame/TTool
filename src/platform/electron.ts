import type { Platform, InstalledPlugin, InstallResult } from './types'
import { webPlatform } from './web'

// Electron 适配器：消费 preload 暴露的 window.ttool 桥接接口。
// 仅在 window.ttool?.platform === 'electron' 时启用（见 index.ts）。
export function createElectronPlatform(bridge: NonNullable<Window['ttool']>): Platform {
  return {
    kind: 'electron',
    isDesktop: true,

    async copyText(text: string) {
      try {
        await bridge.clipboardWrite(text)
      } catch {
        // 桥接异常时退回浏览器实现
        await webPlatform.copyText(text)
      }
    },

    async openExternalApp(path: string) {
      try {
        return await bridge.openExternalApp(path)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },

    async pickAppPath() {
      try {
        return await bridge.pickAppPath()
      } catch {
        return { canceled: true }
      }
    },

    window: {
      minimize: () => void bridge.windowMinimize(),
      toggleMaximize: () => void bridge.windowToggleMaximize(),
      close: () => void bridge.windowClose(),
    },

    // 翻译走主进程 fetch（无 CORS）。
    translate: (text, from, to) => bridge.translate(text, from, to),

    // 全局热键唤醒 / 窗口聚焦事件（来自主进程）。
    onSummon: (cb) => bridge.onSummon(cb),
    onWindowFocus: (cb) => bridge.onWindowFocus(cb),

    // 插件管理（经主进程）。
    plugins: {
      list: () => bridge.plugins.list() as Promise<InstalledPlugin[]>,
      installGithub: (repo, tag) => bridge.plugins.installGithub(repo, tag) as Promise<InstallResult>,
      installLocal: () => bridge.plugins.installLocal() as Promise<InstallResult>,
      installLocalLink: () => bridge.plugins.installLocalLink() as Promise<InstallResult>,
      remove: (id) => bridge.plugins.remove(id),
      setEnabled: (id, enabled) => bridge.plugins.setEnabled(id, enabled),
      update: (id) => bridge.plugins.update(id) as Promise<InstallResult>,
      readBundle: (id) => bridge.plugins.readBundle(id),
    },

    // 宿主能力：通用 net / 命名空间 storage / 加密 secrets / 数据库便利层。
    // bridge.* 已用 types.ts 的权威类型声明（见 vite-env.d.ts），无需断言，漂移会被 typecheck 拦下。
    net: bridge.net,
    storage: bridge.storage,
    secrets: bridge.secrets,
    db: bridge.db,
  }
}
