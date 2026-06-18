import { registerTool } from '../registry'
import { ToolPage, ToolHeader, MONO } from '../ui'
import { usePersistentState } from '../../store/persistentState'
import { useNow } from '../../store/useNow'
import iconUrl from '../../assets/icons/timestamp.png'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// 人类可读时间格式化 —— 逐字移植自设计稿 fmt()。
function fmt(d: Date): string {
  if (isNaN(d.getTime())) return '无效时间'
  const wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${wk}`
}

const fieldStyle = {
  height: 46,
  borderRadius: 11,
  background: 'var(--field)',
  border: '1px solid var(--fieldHair)',
  padding: '0 15px',
  fontFamily: MONO,
  fontSize: 15,
  color: 'var(--text)',
} as const

function TimestampTool() {
  const now = useNow()
  const [tsInput, setTsInput] = usePersistentState('ts.tsInput', '1718600000')
  const [dtInput, setDtInput] = usePersistentState('ts.dtInput', '2025-01-01 00:00')

  const tsNow = String(now)
  const tsNowHuman = fmt(new Date(now * 1000))

  let tsToDate = '—'
  const tsTrim = tsInput.trim()
  const tn = parseInt(tsTrim, 10)
  if (!isNaN(tn)) tsToDate = fmt(new Date(tsTrim.length >= 13 ? tn : tn * 1000))

  let dtToTs = '—'
  const dp = Date.parse(dtInput.replace(/-/g, '/'))
  if (!isNaN(dp)) dtToTs = String(Math.floor(dp / 1000))

  const card = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 18,
    borderRadius: 14,
    background: 'var(--surface2)',
    border: '1px solid var(--hair)',
  } as const

  return (
    <ToolPage scroll>
      <ToolHeader glyph="◷" icon={iconUrl} hue="amber" glyphSize={18} glyphWeight={400} title="Unix 时间戳" subtitle="时间戳与人类可读时间双向转换" mb={22} />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 26, borderRadius: 16, background: 'var(--surface2)', border: '1px solid var(--hair)', marginBottom: 18 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text3)' }}>当前时间戳（秒）</div>
        <div style={{ fontSize: 44, fontWeight: 700, color: 'var(--text)', fontFamily: MONO, letterSpacing: 1 }}>{tsNow}</div>
        <div style={{ fontSize: 13.5, color: 'var(--text2)' }}>{tsNowHuman}</div>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={card}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>时间戳 → 时间</span>
          <input value={tsInput} onChange={(e) => setTsInput(e.target.value)} style={fieldStyle} />
          <div style={{ fontSize: 13.5, color: 'var(--good)', fontFamily: MONO }}>→ {tsToDate}</div>
        </div>
        <div style={card}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>时间 → 时间戳</span>
          <input value={dtInput} onChange={(e) => setDtInput(e.target.value)} style={fieldStyle} />
          <div style={{ fontSize: 13.5, color: 'var(--good)', fontFamily: MONO }}>→ {dtToTs}</div>
        </div>
      </div>
    </ToolPage>
  )
}

registerTool({ id: 'timestamp', name: 'Unix 时间戳', desc: '时间戳双向转换', glyph: '◷', icon: iconUrl, cat: '时间', hue: 'amber', order: 30, component: TimestampTool, keywords: 'timestamp unix time' })
