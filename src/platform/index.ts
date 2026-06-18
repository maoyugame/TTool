import type { Platform } from './types'
import { webPlatform } from './web'
import { createElectronPlatform } from './electron'

// 运行时探测：有 Electron 桥接则用 electron 适配器，否则回退到 web。
// 未来接入 Tauri：在此判断 window.__TAURI__ 并 createTauriPlatform()。
function detect(): Platform {
  if (typeof window !== 'undefined' && window.ttool?.platform === 'electron') {
    return createElectronPlatform(window.ttool)
  }
  return webPlatform
}

export const platform: Platform = detect()
export type { Platform } from './types'
