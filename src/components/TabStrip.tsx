import { useToolbox } from '../store/toolbox'
import { getTool } from '../tools/registry'
import { ToolIcon } from './ToolIcon'
import type { HueName } from '../tools/hue'

const onColor = 'var(--text)'
const offColor = 'var(--text2)'

interface TabModel {
  id: string
  name: string
  glyph: string
  icon?: string
  hue: HueName
  closable: boolean
  active: boolean
}

export function TabStrip() {
  const { view, openTabs, setView, closeTab } = useToolbox()

  const tabs: TabModel[] = [
    { id: 'home', name: '启动台', glyph: '⊞', hue: 'gray', closable: false, active: view === 'home' },
  ]
  for (const id of openTabs) {
    const m = getTool(id)
    if (!m) continue
    tabs.push({ id, name: m.name, glyph: m.glyph, icon: m.icon, hue: m.hue, closable: true, active: view === id })
  }

  return (
    <div
      style={{
        position: 'relative',
        zIndex: 5,
        minHeight: 42,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 5,
        padding: '0 12px',
        background: 'var(--bar)',
        backdropFilter: 'blur(30px) saturate(160%)',
        WebkitBackdropFilter: 'blur(30px) saturate(160%)',
        borderBottom: '1px solid var(--barHair)',
        flexShrink: 0,
      }}
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => setView(tab.id)}
          className={tab.active ? 'tb-tab tb-tab-active' : 'tb-tab hov-surface2'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 34,
            padding: '0 12px',
            borderRadius: '10px 10px 0 0',
            borderTop: `2px solid ${tab.active ? 'var(--accent)' : 'transparent'}`,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: tab.active ? 640 : 540,
            color: tab.active ? onColor : offColor,
            background: tab.active ? 'var(--surface)' : 'transparent',
            boxShadow: tab.active ? '0 -3px 14px rgba(0,0,0,.28)' : 'none',
            transition: 'background .16s,color .16s,border-color .16s',
            maxWidth: 190,
          }}
        >
          <ToolIcon icon={tab.icon} glyph={tab.glyph} hue={tab.hue} size={17} radius={5} glyphSize={10} shadow="none" />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.name}</span>
          {tab.closable && (
            <span
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              className="hov-close"
              style={{ marginLeft: 2, width: 17, height: 17, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 14, flexShrink: 0, transition: 'background .16s,color .16s' }}
            >
              ×
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
