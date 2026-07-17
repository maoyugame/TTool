// 快速启动器小窗（Spotlight 式）：仅搜索框 + 最近工具 + 工具/文件结果。
// 由 main.tsx 在 #launcher 窗口里渲染。选工具→主窗口打开；选文件→默认程序打开。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import './../tools' // 注册内置工具
import { loadInstalledPlugins } from '../plugins/loader'
import { getTool, queryTools } from '../tools/registry'
import { platform } from '../platform'
import { useTheme } from '../theme/ThemeContext'
import { isFileSearchOn, setFileSearchOn, useFileSearch, isExecutableFile } from '../store/fileSearch'
import { ToolIcon } from './ToolIcon'
import { MONO } from '../tools/ui'
import type { HueName } from '../tools/hue'
import { match as pinyinMatch } from 'pinyin-pro'

const RECENTS_KEY = 'ttool.recents'
const THEME_KEY = 'ttool.theme'
const APPS_KEY = 'ttool.apps'

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

type ManualApp = { id: string; name: string; path: string }

// 手动应用与主窗口共享同一个持久化列表；启动器是独立渲染器，不能直接使用主窗口 Context。
function readManualApps(): ManualApp[] {
  try {
    const raw = localStorage.getItem(APPS_KEY)
    const apps = raw ? JSON.parse(raw) : []
    return Array.isArray(apps)
      ? apps.filter((app): app is ManualApp => !!app && typeof app.id === 'string' && typeof app.name === 'string' && typeof app.path === 'string')
      : []
  } catch {
    return []
  }
}

function matchesManualApp(app: ManualApp, query: string): boolean {
  const q = query.toLowerCase()
  if ((app.name + app.path).toLowerCase().includes(q)) return true
  try {
    return !!pinyinMatch(app.name, q)
  } catch {
    return false
  }
}

type Item =
  | { kind: 'tool'; id: string; name: string; desc: string; glyph: string; hue: HueName; icon?: string }
  | { kind: 'app'; id: string; name: string; path: string }
  | { kind: 'file'; path: string; name: string }

export function QuickLauncher() {
  const { theme, setTheme } = useTheme()
  const [query, setQuery] = useState('')
  const [fileOn, setFileOn] = useState(isFileSearchOn())
  const [sel, setSel] = useState(0)
  const [pluginsReady, setPluginsReady] = useState(0)
  const [summonNonce, setSummonNonce] = useState(0) // 每次召唤自增，强制刷新最近使用快照
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 加载插件元数据（用于搜索；不执行 bundle）
  useEffect(() => {
    loadInstalledPlugins().then(() => setPluginsReady((n) => n + 1)).catch(() => {})
  }, [])

  // 召唤时：重置查询、同步主题、聚焦搜索框
  useEffect(() => {
    const off = platform.onSummon?.(() => {
      setQuery('')
      setSel(0)
      setSummonNonce((n) => n + 1) // 触发最近使用重读（query 本就为空时也刷新）
      try {
        const t = localStorage.getItem(THEME_KEY)
        if (t === 'dark' || t === 'light') setTheme(t)
      } catch {
        /* ignore */
      }
      setFileOn(isFileSearchOn())
      setTimeout(() => inputRef.current?.focus(), 30)
    })
    setTimeout(() => inputRef.current?.focus(), 30)
    return () => off?.()
  }, [setTheme])

  const q = query.trim()
  const toolResults = useMemo(() => {
    void pluginsReady
    if (!q) return []
    return queryTools('全部', q).slice(0, 6)
  }, [q, pluginsReady])

  const recentTools = useMemo(() => {
    if (q) return []
    return readRecents()
      .map((id) => getTool(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .slice(0, 5)
  }, [q, pluginsReady, summonNonce])

  const manualAppResults = useMemo(() => {
    if (!q) return []
    return readManualApps().filter((app) => matchesManualApp(app, q)).slice(0, 6)
  }, [q, summonNonce])

  const { hits: fileHits, loading: filesLoading } = useFileSearch(query, fileOn)

  // 组合候选项（工具、手动应用在前，文件在后）
  const items: Item[] = useMemo(() => {
    const tools = (q ? toolResults : recentTools).map(
      (t): Item => ({ kind: 'tool', id: t.id, name: t.name, desc: t.desc, glyph: t.glyph, hue: t.hue, icon: t.icon })
    )
    const apps: Item[] = manualAppResults.map((app) => ({ kind: 'app', id: app.id, name: app.name, path: app.path }))
    const files: Item[] = q && fileOn ? fileHits.slice(0, 8).map((f) => ({ kind: 'file' as const, path: f.path, name: f.name })) : []
    return [...tools, ...apps, ...files]
  }, [q, toolResults, recentTools, manualAppResults, fileHits, fileOn])

  // 选中项越界时归零
  useEffect(() => {
    if (sel >= items.length) setSel(0)
  }, [items.length, sel])

  const activate = useCallback((it: Item) => {
    if (it.kind === 'tool') platform.launcher?.openTool(it.id)
    else if (it.kind === 'app') {
      void platform.openExternalApp(it.path)
      platform.launcher?.hide()
    }
    else {
      void platform.openPath?.(it.path)
      platform.launcher?.hide()
    }
  }, [])

  // 键盘导航：↑↓ 选择，Enter 打开，Esc 隐藏
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => (items.length ? (s + 1) % items.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => (items.length ? (s - 1 + items.length) % items.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items[sel]) activate(items[sel])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      platform.launcher?.hide()
    }
  }

  // 选中项滚动进可视区
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  // 按内容高度上报，让小窗动态贴合内容。summonNonce 入依赖：每次召唤都重量一次，
  // 避免「空查询召唤时内容未变 → 不重测 → 窗口卡在旧/初始高度」。
  useLayoutEffect(() => {
    const h = cardRef.current ? Math.ceil(cardRef.current.getBoundingClientRect().height) + 24 : 72
    platform.launcher?.resize(h)
  }, [items.length, q, fileOn, filesLoading, summonNonce])

  const showHint = q && fileOn

  return (
    <div
      className="tb"
      data-theme={theme}
      style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', background: 'transparent', fontFamily: "system-ui,-apple-system,'SF Pro Display','Segoe UI',sans-serif", padding: 12 }}
    >
      <div
        ref={cardRef}
        style={{ width: '100%', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--hair2)', boxShadow: '0 24px 70px rgba(0,0,0,.45)', overflow: 'hidden' }}
      >
        {/* 搜索栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 56, borderBottom: items.length ? '1px solid var(--hair)' : 'none' }}>
          <svg width="19" height="19" viewBox="0 0 19 19" fill="none" style={{ color: 'var(--accent)', flexShrink: 0 }}>
            <circle cx="8.2" cy="8.2" r="5.6" stroke="currentColor" strokeWidth="1.8" />
            <line x1="12.6" y1="12.6" x2="16.5" y2="16.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSel(0) }}
            onKeyDown={onKey}
            autoFocus
            placeholder={fileOn ? '搜索工具、应用与本机文件…' : '搜索工具与应用…'}
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 17, color: 'var(--text)', minWidth: 0, outline: 'none' }}
          />
          {/* 文件搜索开关 chip */}
          <span
            onClick={() => { const v = !fileOn; setFileOn(v); setFileSearchOn(v); inputRef.current?.focus() }}
            title="切换：是否同时搜索本机文件"
            style={{ fontSize: 11.5, fontWeight: 600, color: fileOn ? '#fff' : 'var(--text2)', background: fileOn ? 'var(--accent)' : 'var(--pill)', padding: '5px 10px', borderRadius: 8, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap', userSelect: 'none' }}
          >
            📁 文件
          </span>
        </div>

        {/* 结果列表 */}
        {items.length > 0 && (
          <div ref={listRef} style={{ maxHeight: 380, overflowY: 'auto', padding: 6 }}>
            {!q && recentTools.length > 0 && (
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--text3)', padding: '6px 8px 4px' }}>最近使用</div>
            )}
            {items.map((it, i) => (
              <Row key={it.kind === 'tool' ? 't:' + it.id : it.kind === 'app' ? 'a:' + it.id : 'f:' + it.path} item={it} active={i === sel} idx={i} onHover={() => setSel(i)} onClick={() => activate(it)} />
            ))}
          </div>
        )}

        {/* 空态 / 提示 */}
        {q && items.length === 0 && (
          <div style={{ padding: '20px 16px', color: 'var(--text3)', fontSize: 13, textAlign: 'center' }}>
            {filesLoading ? '搜索中…' : fileOn ? `没有匹配「${q}」的工具、应用或文件` : `没有匹配「${q}」的工具或应用（开启「📁 文件」可搜本机文件）`}
          </div>
        )}

        {/* 底部快捷键提示 */}
        {(items.length > 0 || showHint) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '7px 0', borderTop: '1px solid var(--hair)', fontSize: 10.5, color: 'var(--text3)', fontFamily: MONO }}>
            <span>↑↓ 选择</span>
            <span>⏎ 打开</span>
            <span>esc 关闭</span>
            {filesLoading && <span style={{ color: 'var(--accent)' }}>· 搜索文件中…</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ item, active, idx, onHover, onClick }: { item: Item; active: boolean; idx: number; onHover: () => void; onClick: () => void }) {
  return (
    <div
      data-idx={idx}
      data-item-kind={item.kind}
      data-item-name={item.name}
      onMouseEnter={onHover}
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', borderRadius: 10, cursor: 'pointer', background: active ? 'var(--accentSoft)' : 'transparent' }}
    >
      {item.kind === 'tool' ? (
        <ToolIcon icon={item.icon} glyph={item.glyph} hue={item.hue} size={32} radius={9} glyphSize={13} shadow="none" />
      ) : (
        <span style={{ width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--pill)', fontSize: 16, flexShrink: 0 }}>{item.kind === 'app' ? '🚀' : '📄'}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 540, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.kind === 'tool' ? item.desc : item.path}
        </div>
      </div>
      {(() => {
        const exec = item.kind === 'file' && isExecutableFile(item.name)
        return (
          <span style={{ fontSize: 10.5, fontWeight: 520, color: exec ? '#fff' : 'var(--text3)', background: exec ? '#d9803a' : 'var(--pill)', padding: '3px 8px', borderRadius: 6, flexShrink: 0 }}>
            {item.kind === 'tool' ? '工具' : item.kind === 'app' ? '应用' : exec ? '可执行' : '文件'}
          </span>
        )
      })()}
    </div>
  )
}
