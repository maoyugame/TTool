// 宿主 SDK：外部插件在运行时通过全局复用宿主的这一份实例（React / SDK），
// 保证整个应用只有一份 React（hooks/context 才正常）。
//
// 外部工具用正常的 `import` 写代码：
//   import React from 'react'
//   import { registerTool, ToolPage, ToolHeader, usePersistentState, useToolbox } from '@ttool/sdk'
// 其构建（见脚手架模板）把 react / react-dom / react/jsx-runtime / @ttool/sdk 标为 external，
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

// SDK 版本：与插件 manifest.sdk 做兼容校验用（主版本）。
export const SDK_VERSION = '1'

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
  // 平台能力（剪贴板 / 打开应用 / 翻译 等，已跨运行时降级）
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
