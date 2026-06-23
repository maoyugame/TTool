import type { FileHit } from '../platform/types'

// 本机文件搜索结果的相关性排序：OS 索引按「最近修改」返回原始候选，这里按「与查询的匹配程度」重排，
// 让最相关的文件浮到前面（否则全是模糊命中、本机搜索就没意义了）。规则见 §排序优先级。

// 噪音目录：系统 / 缓存 / 依赖等，命中则大幅降权，避免淹没用户真正想找的文件。
const NOISE: { re: RegExp; pen: number }[] = [
  { re: /\$recycle\.bin/i, pen: 2000 },
  { re: /[\\/]windows[\\/]/i, pen: 600 },
  { re: /node_modules/i, pen: 500 },
  { re: /[\\/]\.git[\\/]/i, pen: 500 },
  { re: /[\\/](temp|tmp)[\\/]/i, pen: 400 },
  { re: /[\\/]\.?cache/i, pen: 300 },
  { re: /[\\/]appdata[\\/]/i, pen: 280 },
  { re: /[\\/]programdata[\\/]/i, pen: 220 },
  { re: /[\\/]program files( \(x86\))?[\\/]/i, pen: 140 },
]

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

// 给单个文件相对查询打分（分越高越相关）。
export function scoreFile(hit: FileHit, q: string): number {
  const name = (hit.name || '').toLowerCase()
  const path = (hit.path || '').toLowerCase()
  const nameNoExt = stripExt(name)
  const idx = name.indexOf(q)
  let s = 0

  if (name === q || nameNoExt === q) s += 1000 // 文件名完全匹配
  else if (name.startsWith(q) || nameNoExt.startsWith(q)) s += 600 // 前缀匹配
  else if (new RegExp('[ \\-_.\\\\/]' + escapeRe(q)).test(name)) s += 350 // 词边界匹配
  else if (idx >= 0) s += 180 // 文件名内包含
  else s += 10 // 仅路径命中（linux locate 会出现）

  if (idx >= 0) {
    s += Math.max(0, 40 - idx) // 匹配位置越靠前越高
    s += Math.round((q.length / Math.max(name.length, 1)) * 120) // 查询占文件名比例越大越高
  }
  for (const n of NOISE) if (n.re.test(path)) s -= n.pen // 噪音目录降权
  s -= path.split(/[\\/]/).filter(Boolean).length * 2 // 路径越深略降
  return s
}

// 对候选结果按相关性排序，返回前 limit 条。同分保持 OS 原始顺序（最近修改优先）。
export function rankFiles(hits: FileHit[], query: string, limit = 20): FileHit[] {
  const q = (query || '').trim().toLowerCase()
  if (!q || !Array.isArray(hits)) return []
  return hits
    .map((h, i) => ({ h, i, sc: scoreFile(h, q) }))
    .sort((a, b) => b.sc - a.sc || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.h)
}
