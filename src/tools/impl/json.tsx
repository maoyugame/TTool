import { createElement, type ReactNode } from 'react'
import { registerTool } from '../registry'
import { ToolPage, ToolHeader, Panel, ActionPill, MONO } from '../ui'
import { usePersistentState } from '../../store/persistentState'
import { useToolbox } from '../../store/toolbox'
import { useTheme } from '../../theme/ThemeContext'
import iconUrl from '../../assets/icons/json.png'

// JSON 语法高亮 —— 逻辑逐字移植自设计稿 hl()。
function highlight(str: string, dark: boolean): ReactNode {
  const C = dark
    ? { key: '#6db3ff', str: '#7ee787', num: '#ffa657', bool: '#d2a8ff', p: 'rgba(235,235,245,.5)' }
    : { key: '#2c7be5', str: '#1f9d57', num: '#d9730d', bool: '#8957e5', p: 'rgba(60,60,67,.45)' }
  const re = /("(?:\\.|[^"\\])*"\s*:?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
  const nodes: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(str))) {
    if (m.index > last) nodes.push(createElement('span', { key: 'p' + i, style: { color: C.p } }, str.slice(last, m.index)))
    const tok = m[0]
    let col: string
    if (tok[0] === '"') col = /:\s*$/.test(tok) ? C.key : C.str
    else if (tok === 'true' || tok === 'false' || tok === 'null') col = C.bool
    else col = C.num
    nodes.push(createElement('span', { key: 't' + i, style: { color: col } }, tok))
    last = re.lastIndex
    i++
  }
  if (last < str.length) nodes.push(createElement('span', { key: 'e', style: { color: C.p } }, str.slice(last)))
  return createElement('code', { style: { whiteSpace: 'pre' } }, ...nodes)
}

function JsonTool() {
  const { copy } = useToolbox()
  const { theme } = useTheme()
  const [input, setInput] = usePersistentState('json.input', '{"app":"TTool","version":2,"tools":["翻译","JSON","时间戳"],"recent":true,"count":15}')
  const [mode, setMode] = usePersistentState<'pretty' | 'min'>('json.mode', 'pretty')

  let out: ReactNode
  let status: string
  let statusColor: string
  let formatted = ''
  try {
    const obj = JSON.parse(input)
    formatted = mode === 'min' ? JSON.stringify(obj) : JSON.stringify(obj, null, 2)
    out = highlight(formatted, theme === 'dark')
    status = '✓ 有效 JSON'
    statusColor = 'var(--good)'
  } catch (e) {
    out = <span style={{ color: '#ff6b6b' }}>{'✗ ' + (e instanceof Error ? e.message : String(e))}</span>
    status = '✗ 解析错误'
    statusColor = '#ff6b6b'
  }

  return (
    <ToolPage>
      <ToolHeader
        glyph="{}"
        icon={iconUrl}
        hue="purple"
        glyphSize={16}
        title="JSON 格式化"
        subtitle="校验 · 美化 · 压缩 · 转义"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <ActionPill primary onClick={() => setMode('pretty')}>美化</ActionPill>
            <ActionPill onClick={() => setMode('min')}>压缩</ActionPill>
            <ActionPill onClick={() => copy(formatted, 'JSON')}>复制</ActionPill>
          </div>
        }
      />
      <div style={{ flex: 1, display: 'flex', gap: 14, minHeight: 0 }}>
        <Panel label="输入" right={<span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{input.length} 字符</span>}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            style={{ flex: 1, border: 'none', background: 'transparent', resize: 'none', padding: 16, fontFamily: MONO, fontSize: 13, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre' }}
          />
        </Panel>
        <Panel label="输出" right={<span style={{ fontSize: 11.5, fontWeight: 560, color: statusColor }}>{status}</span>}>
          <div style={{ flex: 1, overflow: 'auto', padding: 16, fontFamily: MONO, fontSize: 13, lineHeight: 1.62 }}>{out}</div>
        </Panel>
      </div>
    </ToolPage>
  )
}

registerTool({ id: 'json', name: 'JSON 格式化', desc: '校验 · 美化 · 压缩', glyph: '{}', icon: iconUrl, cat: '开发', hue: 'purple', order: 20, component: JsonTool, keywords: 'json format' })
