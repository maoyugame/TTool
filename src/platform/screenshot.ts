import type { ScreenshotApi } from './types'

// 截图贴图是宿主内置能力，不能挂到会导出给插件的 Platform / TToolSDK.platform 上。
// 内置工具显式导入这个内部模块；外部插件只能拿到经 SDK 暴露的受限 platform。
export const screenshotHost: ScreenshotApi | undefined =
  typeof window !== 'undefined' && window.ttool?.platform === 'electron' ? window.ttool.screenshot : undefined
