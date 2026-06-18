// 渲染层插件加载器：启动时按已装+启用清单注册插件「元数据占位项」（不执行 bundle），
// 工具被打开时再经 readBundle 取源码 → blob 注入 <script> → IIFE 调 registerTool 回填组件。
import { registerPluginManifest, unregisterTool, getTool, getAllTools } from '../tools/registry'
import { platform } from '../platform'
import { HUE, type HueName } from '../tools/hue'
import { SDK_VERSION } from '../sdk'
import type { InstalledPlugin } from '../platform/types'

const HUES = Object.keys(HUE) as HueName[]

// 取插件 bundle 源码 → blob URL → 注入脚本执行（IIFE 复用宿主全局的 React/SDK）。
// 脚本执行完即移除 DOM 节点与 blob，避免孤儿 <script> 累积。
function injectBundle(id: string): Promise<void> {
  return platform.plugins!.readBundle(id).then(
    (code) =>
      new Promise<void>((resolve, reject) => {
        const blob = new Blob([code], { type: 'text/javascript' })
        const url = URL.createObjectURL(blob)
        const s = document.createElement('script')
        s.src = url
        s.onload = () => {
          URL.revokeObjectURL(url)
          s.remove()
          resolve()
        }
        s.onerror = () => {
          URL.revokeObjectURL(url)
          s.remove()
          reject(new Error('插件脚本加载失败：' + id))
        }
        document.head.appendChild(s)
      })
  )
}

function registerOne(p: InstalledPlugin): boolean {
  const m = p.manifest
  if (!m?.id) return false
  if (getTool(m.id)) {
    console.warn(`[plugins] id 与已有工具冲突，已忽略插件：${m.id}`)
    return false
  }
  // SDK 主版本兼容校验
  if (m.sdk && String(m.sdk).split('.')[0] !== SDK_VERSION.split('.')[0]) {
    console.warn(`[plugins] 插件「${m.id}」声明 SDK v${m.sdk}，与宿主 SDK v${SDK_VERSION} 主版本不兼容，已跳过`)
    return false
  }
  registerPluginManifest(
    {
      id: m.id,
      name: m.name || m.id,
      desc: m.desc || '外部插件',
      glyph: m.glyph || '🧩',
      icon: m.icon,
      cat: m.cat || '插件',
      hue: m.hue && HUES.includes(m.hue) ? m.hue : 'gray',
      order: m.order,
      keywords: m.keywords,
    },
    () => injectBundle(m.id)
  )
  return true
}

// 启动时调用：注册所有已启用插件的占位项。返回注册数量。
export async function loadInstalledPlugins(): Promise<number> {
  if (!platform.plugins) return 0
  let list: InstalledPlugin[] = []
  try {
    list = await platform.plugins.list()
  } catch {
    return 0
  }
  let n = 0
  for (const p of list) {
    if (p.enabled === false) continue
    if (registerOne(p)) n++
  }
  return n
}

// 安装/卸载/启停后调用：差量同步——移除已禁用/卸载的插件工具，新增尚未注册的，
// 保留仍启用且已加载的（不丢弃其已加载组件，避免重复注入/重复执行 bundle 副作用）。
export async function syncPlugins(): Promise<void> {
  if (!platform.plugins) {
    for (const t of getAllTools()) if (t.source === 'plugin') unregisterTool(t.id)
    return
  }
  let list: InstalledPlugin[] = []
  try {
    list = await platform.plugins.list()
  } catch {
    return
  }
  const enabledIds = new Set(list.filter((p) => p.enabled !== false && p.manifest?.id).map((p) => p.manifest.id))
  // 移除已禁用 / 卸载的
  for (const t of getAllTools()) {
    if (t.source === 'plugin' && !enabledIds.has(t.id)) unregisterTool(t.id)
  }
  // 新增尚未注册的（已注册且仍启用者保持原状，组件不丢失）
  for (const p of list) {
    if (p.enabled === false) continue
    if (p.manifest?.id && !getTool(p.manifest.id)) registerOne(p)
  }
}
