import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { platform } from '../platform'

// 应用外壳状态：当前视图、已打开标签、最近使用、Toast，以及工具打开/关闭与复制等动作。
// 工具组件通过 useToolbox() 调用 copy()/openTool()，与外壳解耦。

const MAX_RECENTS = 4
const RECENTS_KEY = 'ttool.recents'
const APPS_KEY = 'ttool.apps'

// 用户添加的第三方应用（持久化）。列表按最近打开排序。
export interface AppEntry {
  id: string
  name: string
  path: string
}

interface ToolboxCtx {
  view: string // 'home' 或某个 tool id
  openTabs: string[]
  recents: string[]
  toast: string
  settingsOpen: boolean
  extensionsOpen: boolean
  homeResetNonce: number // 自增信号：唤醒时通知启动台重置查询/筛选，确保展示最近
  toolsNonce: number // 自增信号：插件增删后通知列表刷新
  devMode: boolean // 开发者模式：放开本地插件安装
  setView: (id: string) => void
  openTool: (id: string) => void
  closeTab: (id: string) => void
  flash: (msg: string) => void
  copy: (text: string, label?: string) => void
  openSettings: () => void
  closeSettings: () => void
  openExtensions: () => void
  closeExtensions: () => void
  bumpTools: () => void
  setDevMode: (v: boolean) => void
  registerSearch: (el: HTMLInputElement | null) => void
  focusSearch: () => void
  goHomeAndFocusSearch: () => void
  apps: AppEntry[]
  addApp: (path: string) => void
  openApp: (id: string) => void
  removeApp: (id: string) => void
}

const Ctx = createContext<ToolboxCtx | null>(null)

function initialRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string').slice(0, MAX_RECENTS)
    }
  } catch {
    /* ignore */
  }
  return ['translate', 'json', 'timestamp']
}

function initialApps(): AppEntry[] {
  try {
    const raw = localStorage.getItem(APPS_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        return arr.filter((a) => a && typeof a.id === 'string' && typeof a.path === 'string' && typeof a.name === 'string')
      }
    }
  } catch {
    /* ignore */
  }
  return [] // 默认无任何应用——不预置推荐应用
}

// 从应用路径推导显示名（去扩展名）。
function appNameFromPath(p: string): string {
  const base = p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p
  return base.replace(/\.(app|exe|lnk|bat|cmd|sh|desktop)$/i, '') || base
}

export function ToolboxProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState('home')
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [recents, setRecents] = useState<string[]>(initialRecents)
  const [toast, setToast] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [extensionsOpen, setExtensionsOpen] = useState(false)
  const [homeResetNonce, setHomeResetNonce] = useState(0)
  const [toolsNonce, setToolsNonce] = useState(0)
  const [devMode, setDevModeState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ttool.devMode') === '1'
    } catch {
      return false
    }
  })
  const [apps, setApps] = useState<AppEntry[]>(initialApps)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchElRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
    } catch {
      /* ignore */
    }
  }, [recents])

  useEffect(() => {
    try {
      localStorage.setItem(APPS_KEY, JSON.stringify(apps))
    } catch {
      /* ignore */
    }
  }, [apps])

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const setView = useCallback((id: string) => setViewState(id), [])

  const openTool = useCallback((id: string) => {
    setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]))
    setRecents((rec) => [id, ...rec.filter((r) => r !== id)].slice(0, MAX_RECENTS))
    setViewState(id)
  }, [])

  const closeTab = useCallback((id: string) => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((t) => t !== id)
      setViewState((cur) => (cur === id ? (next.length ? next[next.length - 1] : 'home') : cur))
      return next
    })
  }, [])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 1800)
  }, [])

  const copy = useCallback(
    (text: string, label?: string) => {
      void platform.copyText(text)
      flash(`${label ? label + ' ' : ''}已复制到剪贴板`)
    },
    [flash]
  )

  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const openExtensions = useCallback(() => setExtensionsOpen(true), [])
  const closeExtensions = useCallback(() => setExtensionsOpen(false), [])
  const bumpTools = useCallback(() => setToolsNonce((n) => n + 1), [])
  const setDevMode = useCallback((v: boolean) => {
    setDevModeState(v)
    try {
      localStorage.setItem('ttool.devMode', v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const registerSearch = useCallback((el: HTMLInputElement | null) => {
    searchElRef.current = el
  }, [])

  const focusSearch = useCallback(() => {
    const el = searchElRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  // 回到启动台并聚焦搜索框（Launchpad 重挂载后再聚焦，故延后一帧）。
  // 唤醒/聚焦快捷键触发：重置启动台（清空查询/筛选）以确保展示「最近使用」。
  const goHomeAndFocusSearch = useCallback(() => {
    setViewState('home')
    setSettingsOpen(false)
    setHomeResetNonce((n) => n + 1)
    setTimeout(() => {
      const el = searchElRef.current
      if (el) {
        el.focus()
        el.select()
      }
    }, 70)
  }, [])

  // 添加应用：去重（已存在则提到最前），否则新建并置顶。
  const addApp = useCallback(
    (path: string) => {
      const p = path.trim()
      if (!p) return
      const name = appNameFromPath(p)
      setApps((prev) => {
        const existing = prev.find((a) => a.path === p)
        if (existing) return [existing, ...prev.filter((a) => a.path !== p)]
        const entry: AppEntry = { id: 'app_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, path: p }
        return [entry, ...prev]
      })
      flash('已添加 ' + name)
    },
    [flash]
  )

  // 打开应用：提到最前（最近打开），并通过平台层启动。
  const openApp = useCallback(
    (id: string) => {
      let target: AppEntry | undefined
      setApps((prev) => {
        target = prev.find((a) => a.id === id)
        return target ? [target, ...prev.filter((a) => a.id !== id)] : prev
      })
      if (!target) return
      const app = target
      if (platform.isDesktop) {
        void platform.openExternalApp(app.path).then((r) => flash(r.ok ? '已启动 ' + app.name : r.error || '启动失败'))
      } else {
        flash('桌面版可启动本地应用')
      }
    },
    [flash]
  )

  const removeApp = useCallback((id: string) => {
    setApps((prev) => prev.filter((a) => a.id !== id))
  }, [])

  return (
    <Ctx.Provider
      value={{
        view,
        openTabs,
        recents,
        toast,
        settingsOpen,
        extensionsOpen,
        homeResetNonce,
        toolsNonce,
        devMode,
        setView,
        openTool,
        closeTab,
        flash,
        copy,
        openSettings,
        closeSettings,
        openExtensions,
        closeExtensions,
        bumpTools,
        setDevMode,
        registerSearch,
        focusSearch,
        goHomeAndFocusSearch,
        apps,
        addApp,
        openApp,
        removeApp,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useToolbox(): ToolboxCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToolbox 必须在 ToolboxProvider 内使用')
  return v
}
