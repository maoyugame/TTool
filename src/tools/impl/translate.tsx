import { useState } from 'react'
import { registerTool } from '../registry'
import { ToolPage, ToolHeader, Panel } from '../ui'
import { usePersistentState } from '../../store/persistentState'
import { useToolbox } from '../../store/toolbox'
import { platform } from '../../platform'
import iconUrl from '../../assets/icons/translate.png'

const langNames: Record<string, string> = { zh: '中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français' }

function TranslateTool() {
  const { copy } = useToolbox()
  const [input, setInput] = usePersistentState('translate.input', '人工智能正在改变我们设计与构建软件的方式。')
  const [output, setOutput] = usePersistentState('translate.output', 'AI is transforming the way we design and build software.')
  const [from, setFrom] = usePersistentState('translate.from', 'zh')
  const [to, setTo] = usePersistentState('translate.to', 'en')
  const [note, setNote] = usePersistentState('translate.note', '点击「翻译」开始')
  const [loading, setLoading] = useState(false)

  const fromName = langNames[from]
  const toName = langNames[to]

  async function runTranslate() {
    const text = input.trim()
    if (!text) {
      setOutput('')
      setNote('')
      return
    }
    setLoading(true)
    setNote('翻译中…')
    try {
      const out = await platform.translate?.(text, from, to)
      if (out) {
        setOutput(out)
        setNote('翻译完成')
      } else {
        setNote('未获得译文')
      }
    } catch (e) {
      setNote('翻译失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false)
    }
  }

  function swap() {
    setFrom(to)
    setTo(from)
    setInput(output)
    setOutput(input)
  }

  const langPill = (name: string) => (
    <span style={{ fontSize: 13, fontWeight: 560, color: 'var(--text)', background: 'var(--pill)', padding: '8px 14px', borderRadius: 9, whiteSpace: 'nowrap' }}>
      {name}
    </span>
  )

  return (
    <ToolPage>
      <ToolHeader
        glyph="文A"
        icon={iconUrl}
        hue="blue"
        glyphSize={16}
        title="即时翻译"
        subtitle="多语种实时互译"
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {langPill(fromName)}
            <span
              onClick={swap}
              className="tb-nodrag"
              style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontSize: 15, cursor: 'pointer', flexShrink: 0 }}
            >
              ⇄
            </span>
            {langPill(toName)}
          </div>
        }
      />
      <div style={{ flex: 1, display: 'flex', gap: 14, minHeight: 0 }}>
        <Panel
          label={<span style={{ fontSize: 13, fontWeight: 640, color: 'var(--text)', textTransform: 'none', letterSpacing: 0 }}>{fromName}</span>}
          right={<span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{input.length} 字</span>}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            style={{ flex: 1, border: 'none', background: 'transparent', resize: 'none', padding: 16, fontSize: 16, lineHeight: 1.7, color: 'var(--text)' }}
          />
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--hair)' }}>
            <span onClick={runTranslate} style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--accent)', padding: '9px 20px', borderRadius: 10, cursor: 'pointer' }}>
              翻译
            </span>
          </div>
        </Panel>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, boxShadow: '0 6px 16px rgba(26,127,255,.35)' }}>
            →
          </span>
        </div>
        <Panel
          label={<span style={{ fontSize: 13, fontWeight: 640, color: 'var(--text)', textTransform: 'none', letterSpacing: 0 }}>{toName}</span>}
          right={<span onClick={() => copy(output, '译文')} style={{ fontSize: 11.5, fontWeight: 560, color: 'var(--accent)', cursor: 'pointer' }}>复制</span>}
        >
          <div style={{ flex: 1, overflow: 'auto', padding: 16, fontSize: 16, lineHeight: 1.7, color: 'var(--text)' }}>
            {loading ? '翻译中…' : output}
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--hair)', fontSize: 11.5, color: 'var(--text3)' }}>{note}</div>
        </Panel>
      </div>
    </ToolPage>
  )
}

registerTool({ id: 'translate', name: '即时翻译', desc: '多语种实时互译', glyph: '文A', icon: iconUrl, cat: '翻译', hue: 'blue', order: 10, component: TranslateTool, keywords: 'translate fanyi' })
