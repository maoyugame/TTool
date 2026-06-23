import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useToolbox } from '../store/toolbox'
import { usePersistentState } from '../store/persistentState'
import { platform } from '../platform'
import { kbd } from '../platform/shortcuts'
import { isFileSearchOn, useFileSearch, isExecutableFile } from '../store/fileSearch'
import { getTool, toolCount, filterNames, queryTools } from '../tools/registry'
import type { HueName } from '../tools/hue'
import { MONO } from '../tools/ui'
import { ToolIcon } from './ToolIcon'

interface Row {
  key: string
  name: string
  desc: string
  glyph: string
  hue: HueName
  icon?: string
  cat: string
  pillColor: string
  delay: string
  onOpen: () => void
  onRemove?: () => void // 应用行可移除
}

const delayOf = (i: number) => (0.18 + i * 0.04).toFixed(2) + 's'

// 为用户添加的应用按名称派生稳定配色与字形（无生成图标时）。
const APP_HUES: HueName[] = ['blue', 'purple', 'teal', 'green', 'indigo', 'pink', 'amber']
function appHue(name: string): HueName {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return APP_HUES[h % APP_HUES.length]
}
function appGlyph(name: string): string {
  const t = name.trim()
  if (!t) return '?'
  if (/[一-龥]/.test(t[0])) return t[0]
  const m = t.match(/[A-Za-z0-9]+/)
  return (m ? m[0] : t).slice(0, 2)
}

export function Launchpad() {
  const { recents, openTool, flash, registerSearch, homeResetNonce, apps, addApp, openApp, removeApp } = useToolbox()
  const [query, setQuery] = usePersistentState('home.query', '')
  const [filter, setFilter] = usePersistentState('home.filter', '全部')
  const [picking, setPicking] = useState(false)

  // 唤醒/聚焦快捷键触发时重置启动台（清空查询与筛选），确保展示「最近使用」。
  // 首次挂载不重置，以保留正常标签切换返回时的查询。
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    setQuery('')
    setFilter('全部')
  }, [homeResetNonce, setQuery, setFilter])

  const hr = new Date().getHours()
  const greeting = hr < 6 ? '夜深了' : hr < 12 ? '早上好' : hr < 18 ? '下午好' : '晚上好'
  const q = query.trim().toLowerCase()
  const isAppsFilter = filter === '应用'

  // 本机文件搜索（开关在设置/启动器；开启后搜索框同时搜本机文件）
  const fileOn = isFileSearchOn()
  const { hits: fileHits, loading: filesLoading } = useFileSearch(query, fileOn && !isAppsFilter)

  async function addAppFlow() {
    if (!platform.isDesktop) {
      flash('桌面版可添加本地应用')
      return
    }
    if (picking) return
    setPicking(true)
    try {
      const res = await platform.pickAppPath()
      if (!res.canceled && res.path) addApp(res.path)
    } finally {
      setPicking(false)
    }
  }

  let homeTools: Row[]
  if (isAppsFilter && !q) {
    // 只显示用户已添加的应用（按最近打开排序），无推荐应用、无底部添加卡片。
    homeTools = apps.map((a, i) => ({
      key: 'app:' + a.id,
      name: a.name,
      desc: a.path,
      glyph: appGlyph(a.name),
      hue: appHue(a.name),
      cat: '打开 ↗',
      pillColor: 'var(--accent)',
      delay: delayOf(i),
      onOpen: () => openApp(a.id),
      onRemove: () => removeApp(a.id),
    }))
  } else {
    const list = queryTools(filter, query)
    homeTools = list.map((t, i) => ({
      key: t.id,
      name: t.name,
      desc: t.desc,
      glyph: t.glyph,
      hue: t.hue,
      icon: t.icon,
      cat: t.cat,
      pillColor: 'var(--text2)',
      delay: delayOf(i),
      onOpen: () => openTool(t.id),
    }))
    // 文件结果接在工具结果之后（仅在有查询且开了文件搜索时）
    if (q && fileOn) {
      const base = homeTools.length
      for (let i = 0; i < fileHits.length; i++) {
        const f = fileHits[i]
        const exec = isExecutableFile(f.name)
        homeTools.push({
          key: 'file:' + f.path,
          name: f.name,
          desc: f.path,
          glyph: exec ? '⚙️' : '📄',
          hue: 'gray',
          cat: exec ? '可执行 ↗' : '文件 ↗',
          pillColor: exec ? '#d9803a' : 'var(--accent)',
          delay: delayOf(base + i),
          onOpen: () => { void platform.openPath?.(f.path) },
        })
      }
    }
  }

  const recentChips = recents.map((id) => getTool(id)).filter((t): t is NonNullable<typeof t> => !!t)
  const showRecents = !q && !isAppsFilter && recentChips.length > 0
  const listLabel = q ? '搜索结果' : filter === '全部' ? '全部工具' : isAppsFilter ? '我的应用' : filter
  const appsEmpty = isAppsFilter && !q && apps.length === 0
  const noResults = !isAppsFilter && homeTools.length === 0 && !filesLoading

  return (
    <div style={{ height: '100%', display: 'flex', justifyContent: 'center', animation: 'fadeIn .3s both' }}>
      <div style={{ width: '100%', maxWidth: 760, height: '100%', padding: '26px 32px 16px', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ textAlign: 'center', fontSize: 14, color: 'var(--text2)', marginBottom: 12, flexShrink: 0, animation: 'fadeUp .5s both' }}>
          {greeting} · {toolCount()} 个工具就绪
        </div>

        {/* 命令搜索栏 */}
        <div className="cmdbar" style={{ display: 'flex', alignItems: 'center', gap: 13, height: 52, padding: '0 18px', borderRadius: 14, background: 'var(--surface2)', border: '1px solid var(--hair2)', boxShadow: '0 16px 40px rgba(0,0,0,.18)', flexShrink: 0, animation: 'fadeUp .5s both', animationDelay: '.04s' }}>
          <svg width="20" height="20" viewBox="0 0 19 19" fill="none" style={{ color: 'var(--accent)', flexShrink: 0 }}>
            <circle cx="8.2" cy="8.2" r="5.6" stroke="currentColor" strokeWidth="1.8" />
            <line x1="12.6" y1="12.6" x2="16.5" y2="16.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={registerSearch}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索工具，或直接输入文本 / 计算…"
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 17, color: 'var(--text)', minWidth: 0 }}
          />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', fontFamily: MONO, background: 'var(--pill)', padding: '5px 9px', borderRadius: 7, flexShrink: 0 }}>{kbd('K')}</span>
        </div>

        {/* 分段筛选 */}
        <div style={{ display: 'flex', gap: 5, alignSelf: 'center', marginTop: 14, padding: 4, background: 'var(--pill)', borderRadius: 11, flexShrink: 0, animation: 'fadeUp .5s both', animationDelay: '.08s' }}>
          {filterNames().map((n) => {
            const on = filter === n
            return (
              <span
                key={n}
                onClick={() => setFilter(n)}
                style={{ fontSize: 13, fontWeight: on ? 560 : 520, color: on ? '#fff' : 'var(--text2)', background: on ? 'var(--accent)' : 'transparent', boxShadow: on ? '0 3px 10px rgba(10,108,255,.3)' : 'none', padding: '6px 15px', borderRadius: 8, cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' }}
              >
                {n}
              </span>
            )
          })}
        </div>

        {/* 最近使用（工具） */}
        {showRecents && (
          <div style={{ marginTop: 18, flexShrink: 0, animation: 'fadeUp .5s both', animationDelay: '.12s' }}>
            <div style={{ fontSize: 11.5, fontWeight: 680, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 9 }}>最近使用</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {recentChips.map((r) => (
                <div
                  key={r.id}
                  onClick={() => openTool(r.id)}
                  className="hov-lift"
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px 8px 8px', borderRadius: 12, background: 'var(--surface2)', border: '1px solid var(--hair)', cursor: 'pointer', transition: 'transform .18s,border-color .18s' }}
                >
                  <ToolIcon icon={r.icon} glyph={r.glyph} hue={r.hue} size={28} radius={8} glyphSize={12} shadow="none" />
                  <span style={{ fontSize: 13.5, fontWeight: 540, color: 'var(--text)' }}>{r.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 列表标签 + 添加应用按钮 */}
        <div style={{ marginTop: 16, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, minHeight: 28, animation: 'fadeUp .5s both', animationDelay: '.16s' }}>
          <span style={{ fontSize: 11.5, fontWeight: 680, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--text3)' }}>{listLabel}</span>
          {isAppsFilter && (
            <span
              onClick={addAppFlow}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 560, color: '#fff', background: 'var(--accent)', padding: '6px 13px', borderRadius: 9, cursor: 'pointer', boxShadow: '0 3px 10px rgba(10,108,255,.3)', whiteSpace: 'nowrap' }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>＋</span> 添加应用
            </span>
          )}
        </div>

        {/* 列表（固定高度 + 内部滚动） */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {homeTools.map((t) => (
            <ToolRow key={t.key} row={t} />
          ))}
          {appsEmpty && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 24px', color: 'var(--text3)', textAlign: 'center' }}>
              <span style={{ fontSize: 30, opacity: 0.6 }}>🗂️</span>
              <span style={{ fontSize: 14, color: 'var(--text2)' }}>还没有添加应用</span>
              <span style={{ fontSize: 12.5 }}>点击右上角「＋ 添加应用」，选择本地应用后即可一键启动</span>
            </div>
          )}
          {noResults && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)', fontSize: 14 }}>
              没有匹配「{query}」的{fileOn ? '工具或文件' : '工具'}
            </div>
          )}
          {q && fileOn && filesLoading && homeTools.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)', fontSize: 14 }}>搜索本机文件中…</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 14, fontSize: 11.5, color: 'var(--text3)', fontFamily: MONO, flexShrink: 0 }}>
          <span>↑↓ 选择</span>
          <span>⏎ 打开</span>
          <span>{kbd('W')} 关闭标签</span>
          <span>esc 返回</span>
        </div>
      </div>
    </div>
  )
}

function ToolRow({ row }: { row: Row }): ReactNode {
  return (
    <div
      onClick={row.onOpen}
      className="hov-surface2 tool-row"
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 13px', borderRadius: 13, cursor: 'pointer', transition: 'background .15s', animation: 'fadeUp .45s both', animationDelay: row.delay }}
    >
      <span className="tool-row-icon" style={{ display: 'flex', transition: 'transform .18s' }}>
        <ToolIcon icon={row.icon} glyph={row.glyph} hue={row.hue} size={40} radius={11} glyphSize={16} shadow="list" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 560, color: 'var(--text)' }}>{row.name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.desc}</div>
      </div>
      {row.cat && (
        <span style={{ fontSize: 11.5, fontWeight: 520, color: row.pillColor, background: 'var(--pill)', padding: '4px 10px', borderRadius: 7, flexShrink: 0, whiteSpace: 'nowrap' }}>{row.cat}</span>
      )}
      {row.onRemove && (
        <span
          onClick={(e) => {
            e.stopPropagation()
            row.onRemove!()
          }}
          className="row-remove hov-close"
          title="移除应用"
          style={{ width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 15, flexShrink: 0 }}
        >
          ×
        </span>
      )}
    </div>
  )
}
