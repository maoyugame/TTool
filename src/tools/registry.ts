import { match as pinyinMatch } from 'pinyin-pro'
import type { ComponentType } from 'react'
import type { ToolPlugin, ToolCategory } from './types'
import type { HueName } from './hue'

// 工具注册表：收集内置工具与外部插件，提供查询/分类/搜索。
// 展示顺序由各插件的 order 字段决定（升序，稳定排序）；未声明 order 者按注册顺序排在其后。
const tools: ToolPlugin[] = []
const byId = new Map<string, ToolPlugin>()
// 懒加载插件：id → 等待其 bundle 提供组件的 resolve 回调
const pendingLoaders = new Map<string, (c: ComponentType) => void>()
// 在途加载的 promise（按 id 去重，避免并发/重挂载重复注入与挂起）
const loadingPromises = new Map<string, Promise<ComponentType>>()

export function registerTool(plugin: ToolPlugin): void {
  const existing = byId.get(plugin.id)
  if (existing) {
    // 插件 bundle 执行时回填组件到已注册的 manifest 占位项，并 resolve 其 load promise
    if (plugin.component && !existing.component) {
      existing.component = plugin.component
      existing.name = existing.name || plugin.name
      existing.desc = existing.desc || plugin.desc
      existing.glyph = existing.glyph || plugin.glyph
      existing.icon = existing.icon ?? plugin.icon
      const resolve = pendingLoaders.get(plugin.id)
      if (resolve) {
        pendingLoaders.delete(plugin.id)
        resolve(plugin.component)
      }
      return
    }
    console.warn(`[registry] 工具 id 重复，忽略：${plugin.id}`)
    return
  }
  const entry: ToolPlugin = { source: 'builtin', ...plugin }
  byId.set(entry.id, entry)
  tools.push(entry)
}

interface PluginMeta {
  id: string
  name: string
  desc: string
  glyph: string
  icon?: string
  cat: string
  hue: HueName
  order?: number
  keywords?: string
}

// 注册外部插件的元数据占位项（不执行 bundle，仅用于列表）；首次打开时 loadBundle 注入 bundle，
// bundle 内的 registerTool 回填组件并 resolve 此 load 的 promise（见上方 registerTool）。
export function registerPluginManifest(meta: PluginMeta, loadBundle: () => Promise<void>): void {
  if (byId.has(meta.id)) {
    console.warn(`[registry] 插件 id 与已有工具重复，忽略：${meta.id}`)
    return
  }
  const entry: ToolPlugin = {
    ...meta,
    source: 'plugin',
    component: undefined,
    load: () => {
      const e = byId.get(meta.id)
      if (e?.component) return Promise.resolve(e.component)
      const inflight = loadingPromises.get(meta.id)
      if (inflight) return inflight // 复用在途加载，避免重复注入/挂起
      const p = new Promise<ComponentType>((resolve, reject) => {
        pendingLoaders.set(meta.id, resolve)
        loadBundle()
          .then(() => {
            // 脚本已执行；若仍未回填组件，说明该插件未正确调用 registerTool
            if (!byId.get(meta.id)?.component) {
              pendingLoaders.delete(meta.id)
              reject(new Error(`插件「${meta.id}」加载后未注册工具组件（应调用 registerTool/defineTool）`))
            }
          })
          .catch((err) => {
            pendingLoaders.delete(meta.id)
            reject(err instanceof Error ? err : new Error(String(err)))
          })
      })
      loadingPromises.set(meta.id, p)
      // 成功后组件已回填（后续 load 走上面短路）；失败允许重试——两种情况都清掉在途缓存
      p.then(
        () => loadingPromises.delete(meta.id),
        () => loadingPromises.delete(meta.id)
      )
      return p
    },
  }
  byId.set(entry.id, entry)
  tools.push(entry)
}

// 卸载/禁用插件时从注册表移除。
export function unregisterTool(id: string): void {
  const i = tools.findIndex((t) => t.id === id)
  if (i >= 0) tools.splice(i, 1)
  byId.delete(id)
  pendingLoaders.delete(id)
  loadingPromises.delete(id)
}

// 按 order 升序的稳定排序视图（Array.sort 在 ES2019+ 稳定）。
function ordered(): ToolPlugin[] {
  return tools.slice().sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9))
}

export function getTool(id: string): ToolPlugin | undefined {
  return byId.get(id)
}

export function getAllTools(): ToolPlugin[] {
  return ordered()
}

export function toolCount(): number {
  return tools.length
}

// 分类展示顺序（与设计稿一致）；注册了未知分类时追加在后面。
const CATEGORY_ORDER: ToolCategory[] = ['开发', '文本', '时间', '翻译', '设计']

// 启动台分段筛选项：全部 + 实际存在的分类（按既定顺序） + 应用
export function filterNames(): string[] {
  const present = new Set<string>(tools.map((t) => t.cat))
  const known: string[] = CATEGORY_ORDER
  const ordered: string[] = known.filter((c) => present.has(c))
  for (const t of tools) {
    if (!known.includes(t.cat) && !ordered.includes(t.cat)) ordered.push(t.cat)
  }
  return ['全部', ...ordered, '应用']
}

// 按筛选 + 查询过滤工具（不含"应用"逻辑，应用在启动台单独处理）。
// 支持：字面包含匹配 + 中文拼音匹配（全拼 / 首字母 / 混合，由 pinyin-pro 提供，对新工具自动生效）。
export function queryTools(filter: string, query: string): ToolPlugin[] {
  const raw = query.trim()
  const q = raw.toLowerCase()
  let list = ordered()
  if (filter !== '全部' && filter !== '应用') list = list.filter((t) => t.cat === filter)
  if (q) {
    list = list.filter((t) => {
      const hay = (t.name + t.desc + t.cat + (t.keywords ?? '')).toLowerCase()
      if (hay.includes(q)) return true
      try {
        // 对工具中文名做拼音匹配，如 "fanyi" / "fy" 命中「即时翻译」
        if (pinyinMatch(t.name, q)) return true
      } catch {
        /* 非中文或匹配异常时忽略，回退到字面匹配 */
      }
      return false
    })
  }
  return list
}
