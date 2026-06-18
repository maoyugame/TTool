import type { ComponentType } from 'react'
import type { HueName } from './hue'

export type ToolCategory = '开发' | '文本' | '时间' | '翻译' | '设计'

// 工具插件契约 —— "做好兼容"的核心。
// 新增一个工具 = 新建一个实现本接口的文件并 registerTool()，
// 外壳 / 启动台 / 标签栏全部零改动。
export interface ToolPlugin {
  /** 唯一标识，也是标签/路由 key */
  id: string
  /** 显示名 */
  name: string
  /** 一句话描述（列表副标题） */
  desc: string
  /** 图标字形（无图标图片时回退显示） */
  glyph: string
  /** 生成的图标图片 URL（可选，优先于 glyph 显示） */
  icon?: string
  /** 分类（决定筛选归属）。内置用 ToolCategory，外部插件可用任意字符串（空分类自动隐藏）。 */
  cat: ToolCategory | (string & {})
  /** 图标配色 */
  hue: HueName
  /** 工具主体组件（内置工具 / 已加载的插件）。懒加载插件初始为空，由 load 提供。 */
  component?: ComponentType
  /** 懒加载入口（外部插件）：首次打开时调用，解析出工具组件。 */
  load?: () => Promise<ComponentType>
  /** 来源：内置 或 外部插件 */
  source?: 'builtin' | 'plugin'
  /** 搜索关键词补充（可选，叠加到 name+desc+cat 上），便于拼音/英文别名命中 */
  keywords?: string
  /**
   * 展示排序（可选，越小越靠前）。每个工具在自己文件里声明，无需维护中央顺序表——
   * 这样多个 agent 并行开发的工具落盘后顺序自洽。未声明者按注册顺序排在已声明者之后。
   */
  order?: number
}

// 外部插件的 manifest.json 规范（安装期无需执行 bundle 即可拿到列表元数据）。
export interface PluginManifest {
  /** 全局唯一 id */
  id: string
  name: string
  desc?: string
  glyph?: string
  /** 图标：相对 bundle 的资源文件名，或 data URL */
  icon?: string
  cat: string
  hue?: HueName
  order?: number
  keywords?: string
  /** 插件版本（语义化版本） */
  version: string
  /** 入口 bundle 文件名（IIFE），如 "tool.js" */
  entry: string
  /** 兼容的 SDK 主版本（可选，宿主据此校验） */
  sdk?: string
}
