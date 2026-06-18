import type { ReactNode, CSSProperties } from 'react'
import type { HueName } from './hue'
import { ToolIcon } from '../components/ToolIcon'

export const MONO = "ui-monospace, 'SF Mono', Menlo, monospace"

// 工具页外层容器。scroll=true 走可滚动布局，否则走 flex 纵向填充（两栏型工具）。
export function ToolPage({ scroll, children }: { scroll?: boolean; children: ReactNode }) {
  const base: CSSProperties = { height: '100%', padding: '24px 28px', animation: 'fadeUp .4s both' }
  const layout: CSSProperties = scroll
    ? { overflowY: 'auto' }
    : { display: 'flex', flexDirection: 'column' }
  return <div style={{ ...base, ...layout }}>{children}</div>
}

interface HeaderProps {
  glyph: string
  icon?: string
  hue: HueName
  glyphSize?: number
  glyphWeight?: number
  title: string
  subtitle: ReactNode
  right?: ReactNode
  mb?: number
}

// 工具详情页头部：彩色图标 + 标题 + 副标题，可选右侧操作区。
export function ToolHeader({ glyph, icon, hue, glyphSize = 16, glyphWeight = 600, title, subtitle, right, mb = 18 }: HeaderProps) {
  const iconEl = <ToolIcon icon={icon} glyph={glyph} hue={hue} size={40} radius={11} glyphSize={glyphSize} glyphWeight={glyphWeight} shadow="header" />

  const titleBlock = (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{subtitle}</div>
    </div>
  )
  if (right) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: mb }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          {iconEl}
          {titleBlock}
        </div>
        {right}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: mb }}>
      {iconEl}
      {titleBlock}
    </div>
  )
}

// 卡片标题栏上的小标签文字（输入/输出等）。
export const labelStyle: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 680,
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
}

// 输入/输出面板卡片。
export function Panel({
  label,
  right,
  children,
  flex = true,
}: {
  label: ReactNode
  right?: ReactNode
  children: ReactNode
  flex?: boolean
}) {
  return (
    <div
      style={{
        flex: flex ? 1 : undefined,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 14,
        overflow: 'hidden',
        background: 'var(--surface2)',
        border: '1px solid var(--hair)',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '11px 15px',
          borderBottom: '1px solid var(--hair)',
        }}
      >
        <span style={labelStyle}>{label}</span>
        {right}
      </div>
      {children}
    </div>
  )
}

// 编码/解码 之类的分段切换控件。
export function Seg({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (k: string) => void
}) {
  return (
    <div style={{ display: 'inline-flex', background: 'var(--pill)', borderRadius: 9, padding: 3 }}>
      {options.map((o) => {
        const on = o.key === value
        return (
          <span
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              fontSize: 12.5,
              fontWeight: 560,
              color: on ? 'var(--text)' : 'var(--text2)',
              background: on ? 'var(--surface3)' : 'transparent',
              padding: '7px 15px',
              borderRadius: 7,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </span>
        )
      })}
    </div>
  )
}

// 工具页内常用的纯文本"操作药丸"按钮。
export function ActionPill({
  onClick,
  primary,
  children,
}: {
  onClick: () => void
  primary?: boolean
  children: ReactNode
}) {
  return (
    <span
      onClick={onClick}
      style={{
        fontSize: 12.5,
        fontWeight: primary ? 560 : 540,
        color: primary ? '#fff' : 'var(--text)',
        background: primary ? 'var(--accent)' : 'var(--pill)',
        padding: primary ? '9px 16px' : '9px 15px',
        borderRadius: 10,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}
