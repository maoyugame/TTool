/// <reference types="vite/client" />

// Electron 预加载注入的桥接接口（仅在 electron 壳内存在）。
interface TToolBridge {
  platform: 'electron'
  os: string
  clipboardWrite: (text: string) => Promise<boolean>
  openExternalApp: (path: string) => Promise<{ ok: boolean; error?: string }>
  pickAppPath: () => Promise<{ canceled: boolean; path?: string }>
  windowMinimize: () => Promise<void>
  windowToggleMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  translate: (text: string, from: string, to: string) => Promise<string>
  mode: 'main' | 'launcher'
  onSummon: (cb: () => void) => () => void
  onWindowFocus: (cb: () => void) => () => void
  onOpenTool: (cb: (id: string) => void) => () => void
  codexUsage: import('./platform/types').CodexUsageApi
  updates: {
    getState: () => Promise<import('./platform/types').UpdateState>
    check: () => Promise<import('./platform/types').UpdateCommandResult>
    download: () => Promise<import('./platform/types').UpdateCommandResult>
    install: () => Promise<import('./platform/types').UpdateCommandResult>
    onState: (cb: (state: import('./platform/types').UpdateState) => void) => () => void
  }
  launcher: {
    hide: () => Promise<boolean>
    openTool: (id: string) => Promise<boolean>
    resize: (height: number) => Promise<boolean>
  }
  files: {
    search: (query: string) => Promise<{ path: string; name: string }[]>
    searchDeep: (query: string) => Promise<{ path: string; name: string }[]>
    open: (path: string) => Promise<{ ok: boolean; error?: string }>
    reveal: (path: string) => Promise<boolean>
  }
  plugins: {
    list: () => Promise<unknown[]>
    installGithub: (repo: string, tag?: string) => Promise<unknown>
    installLocal: () => Promise<unknown>
    installLocalLink: () => Promise<unknown>
    remove: (id: string) => Promise<void>
    setEnabled: (id: string, enabled: boolean) => Promise<void>
    update: (id: string) => Promise<unknown>
    readBundle: (id: string) => Promise<string>
  }
  // 直接引用 src/platform/types 的权威类型（单一来源），任一处签名漂移会在 typecheck 暴露。
  net: import('./platform/types').NetApi
  storage: import('./platform/types').StorageApi
  secrets: import('./platform/types').SecretsApi
  db: import('./platform/types').DbApi
  screenshot: import('./platform/types').ScreenshotApi & {
    overlaySelect: (payload: import('./platform/types').ScreenshotOverlaySelectionPayload) => Promise<import('./platform/types').SimpleResult>
    overlayCancel: (payload: { captureId: string; reason?: string }) => Promise<import('./platform/types').SimpleResult>
  }
}

interface Window {
  ttool?: TToolBridge
  // 可选的翻译服务注入点（接入真实服务后填充）。
  claude?: { complete: (prompt: string) => Promise<string> }
}
