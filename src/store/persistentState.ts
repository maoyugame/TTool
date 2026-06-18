import { useState, useCallback } from 'react'

// 工具标签在切换时会卸载/重挂载（以重放入场动效），但用户输入需要保留。
// 这个 hook 把状态存在模块级 Map 中，跨卸载存活；重挂载时自动回填。
// 让每个工具都能用普通的 useState 写法，同时保持自包含、可插拔。
const store = new Map<string, unknown>()

export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial))

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
        store.set(key, next)
        return next
      })
    },
    [key]
  )

  return [value, set]
}
