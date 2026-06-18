// 工具图标配色 —— 调色板逐字移植自设计稿 meta() 的 hue 表。
export type HueName = 'blue' | 'purple' | 'amber' | 'teal' | 'green' | 'indigo' | 'pink' | 'gray'

export const HUE: Record<HueName, [string, string]> = {
  blue: ['#5aa9ff', '#1a7fff'],
  purple: ['#b482ff', '#8a4bff'],
  amber: ['#ffb84d', '#ff9500'],
  teal: ['#4dd6c8', '#0fb5a6'],
  green: ['#5fd66a', '#28c740'],
  indigo: ['#7a86ff', '#4a5bff'],
  pink: ['#ff7eb3', '#ff4d8d'],
  gray: ['#aeb2bd', '#82879a'],
}

export function iconBg(hue: HueName): string {
  const [a, b] = HUE[hue]
  return `linear-gradient(135deg,${a},${b})`
}

export function iconShadow(hue: HueName): string {
  const [, b] = HUE[hue]
  return `0 4px 11px ${b}38`
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// amber 是设计稿里唯一一个 header 阴影色不等于渐变末端的特例：设计师把它特意调成更偏红的
// rgb(255,138,0)（见设计稿时间戳 173 行 / 时区 425 行）；其余 hue 的阴影色都 == 渐变末端。
const HEADER_SHADOW_OVERRIDE: Partial<Record<HueName, string>> = {
  amber: 'rgba(255, 138, 0, 0.34)',
}

// 工具详情页头部图标的投影（比列表图标更重，对应设计稿 0 5px 15px rgba(...,.32~.35)）。
export function headerIconShadow(hue: HueName): string {
  return `0 5px 15px ${HEADER_SHADOW_OVERRIDE[hue] ?? hexToRgba(HUE[hue][1], 0.34)}`
}
