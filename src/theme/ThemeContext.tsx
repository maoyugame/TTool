import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'

interface ThemeCtx {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

const Ctx = createContext<ThemeCtx | null>(null)

const STORAGE_KEY = 'ttool.theme'

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return 'dark' // 设计默认深色
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* ignore */
    }
  }, [])

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  return <Ctx.Provider value={{ theme, toggle, setTheme }}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTheme 必须在 ThemeProvider 内使用')
  return v
}
