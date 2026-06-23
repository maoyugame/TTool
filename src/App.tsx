import './tools' // 副作用导入：注册全部内置工具到注册表
import { useEffect, useMemo, useState, lazy, Suspense, Component, type ReactNode, type ComponentType } from 'react'
import { useTheme } from './theme/ThemeContext'
import { ToolboxProvider, useToolbox } from './store/toolbox'
import { platform } from './platform'
import { isModKey } from './platform/shortcuts'
import { loadInstalledPlugins } from './plugins/loader'
import { TitleBar } from './components/TitleBar'
import { TabStrip } from './components/TabStrip'
import { Orbs } from './components/Orbs'
import { Toast } from './components/Toast'
import { Launchpad } from './components/Launchpad'
import { SettingsPanel } from './components/SettingsPanel'
import { ExtensionsPanel } from './components/ExtensionsPanel'
import { getTool } from './tools/registry'
import { PluginContext } from './sdk'
import type { ToolPlugin } from './tools/types'

// 插件加载中占位
function PluginLoading({ name }: { name: string }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text2)' }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', border: '2.5px solid var(--hair2)', borderTopColor: 'var(--accent)', animation: 'spin .8s linear infinite' }} />
      <span style={{ fontSize: 13.5 }}>正在加载「{name}」…</span>
    </div>
  )
}

// 插件加载/渲染错误边界，避免坏插件白屏整个应用
class PluginErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32, textAlign: 'center', color: 'var(--text2)' }}>
          <span style={{ fontSize: 28 }}>⚠️</span>
          <span style={{ fontSize: 14, color: 'var(--text)' }}>插件「{this.props.name}」加载失败</span>
          <span style={{ fontSize: 12.5, fontFamily: 'ui-monospace,monospace', maxWidth: 520, wordBreak: 'break-word' }}>{this.state.error}</span>
        </div>
      )
    }
    return this.props.children
  }
}

function LazyTool({ plugin }: { plugin: ToolPlugin }) {
  const Lazy = useMemo(
    () => lazy(async () => ({ default: (await plugin.load!()) as ComponentType })),
    [plugin]
  )
  return (
    <PluginErrorBoundary name={plugin.name}>
      <Suspense fallback={<PluginLoading name={plugin.name} />}>
        <Lazy />
      </Suspense>
    </PluginErrorBoundary>
  )
}

// 内容区路由：home 渲染启动台；内置工具直接渲染；外部插件懒加载。
function Content() {
  const { view, toolsNonce } = useToolbox()
  // 读 toolsNonce 以便插件注册后重渲染（订阅 context 变化）
  void toolsNonce
  if (view === 'home') return <Launchpad key="home" />
  const tool = getTool(view)
  if (!tool) return <Launchpad key="home" />
  // 用 PluginContext 提供当前工具 id，作为 useStorage/useSecrets/useNet 的命名空间。
  if (tool.component) {
    const C = tool.component
    return (
      <PluginContext.Provider value={view}>
        <C key={view} />
      </PluginContext.Provider>
    )
  }
  if (tool.load)
    return (
      <PluginContext.Provider value={view}>
        <LazyTool key={view} plugin={tool} />
      </PluginContext.Provider>
    )
  return <Launchpad key="home" />
}

function Shell() {
  const { theme } = useTheme()
  const { view, settingsOpen, extensionsOpen, setView, openTool, closeTab, closeSettings, closeExtensions, focusSearch, goHomeAndFocusSearch, bumpTools } = useToolbox()
  const [, setLoadedTick] = useState(0)

  // 启动加载已装插件（仅桌面有 platform.plugins）
  useEffect(() => {
    let alive = true
    loadInstalledPlugins().then((n) => {
      if (alive && n > 0) {
        bumpTools()
        setLoadedTick((t) => t + 1)
      }
    })
    return () => {
      alive = false
    }
  }, [bumpTools])

  // 键盘快捷键（平台感知修饰键）+ 启动台输入即搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (extensionsOpen) {
        if (e.key === 'Escape') {
          e.preventDefault()
          closeExtensions()
        }
        return
      }
      if (settingsOpen) {
        if (e.key === 'Escape') {
          e.preventDefault()
          closeSettings()
        }
        return
      }
      if (isModKey(e) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        goHomeAndFocusSearch()
        return
      }
      if (isModKey(e) && (e.key === 'w' || e.key === 'W')) {
        if (view !== 'home') {
          e.preventDefault()
          closeTab(view)
        }
        return
      }
      if (e.key === 'Escape') {
        if (view !== 'home') {
          e.preventDefault()
          setView('home')
        }
        return
      }
      if (view === 'home' && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        const ae = document.activeElement as HTMLElement | null
        const tag = ae?.tagName
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !ae?.isContentEditable) focusSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, settingsOpen, extensionsOpen, setView, closeTab, closeSettings, closeExtensions, focusSearch, goHomeAndFocusSearch])

  // 桌面：全局热键唤醒 + 窗口激活时自动聚焦搜索框
  useEffect(() => {
    const offSummon = platform.onSummon?.(() => goHomeAndFocusSearch())
    const offFocus = platform.onWindowFocus?.(() => focusSearch())
    return () => {
      offSummon?.()
      offFocus?.()
    }
  }, [focusSearch, goHomeAndFocusSearch])

  // 桌面：快速启动器小窗请求打开某工具
  useEffect(() => {
    const off = platform.onOpenTool?.((id) => {
      if (getTool(id)) openTool(id) // 已注册（内置/已装插件）→ 打开（加标签+最近）
    })
    return () => off?.()
  }, [openTool])

  return (
    <div
      className="tb"
      data-theme={theme}
      style={{
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: 'var(--wall)',
        fontFamily: "system-ui,-apple-system,'SF Pro Display','Segoe UI',sans-serif",
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        transition: 'background .45s ease',
      }}
    >
      <Orbs />
      <TitleBar />
      <TabStrip />
      <div style={{ position: 'relative', zIndex: 1, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Content />
      </div>
      <Toast />
      <SettingsPanel />
      <ExtensionsPanel />
    </div>
  )
}

export function App() {
  return (
    <ToolboxProvider>
      <Shell />
    </ToolboxProvider>
  )
}
