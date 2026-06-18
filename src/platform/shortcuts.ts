// 平台感知的快捷键标签：macOS 用 ⌘，Windows/Linux 用 Ctrl。
function detectMac(): boolean {
  if (typeof window === 'undefined') return false
  const os = window.ttool?.os
  if (os) return os === 'darwin'
  const p = navigator.platform || navigator.userAgent || ''
  return /Mac|iPhone|iPad|iPod/i.test(p)
}

export const IS_MAC = detectMac()
export const MOD = IS_MAC ? '⌘' : 'Ctrl'

// 组合键展示标签：mac 紧凑 "⌘K"，其它 "Ctrl K"
export function kbd(key: string): string {
  return IS_MAC ? `⌘${key}` : `Ctrl ${key}`
}

// 判断某个键盘事件是否按下了"主修饰键"（mac=⌘ / 其它=Ctrl）
export function isModKey(e: KeyboardEvent): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey
}
