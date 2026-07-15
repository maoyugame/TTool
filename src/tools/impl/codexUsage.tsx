import { useEffect, useMemo, useState } from 'react'
import { platform } from '../../platform'
import type { CodexTokenUsage, CodexUsageConnection, CodexUsageLimit, CodexUsageState, CodexUsageWindow } from '../../platform/types'
import { registerTool } from '../registry'
import { ActionPill, MONO, Panel, ToolHeader, ToolPage } from '../ui'

const STALE_AFTER_MS = 2 * 60 * 1000

const EMPTY_STATE: CodexUsageState = {
  connection: 'idle',
  error: null,
  updatedAt: null,
  lastSuccessfulRefreshAt: null,
  rateLimits: null,
  usage: null,
  enabled: false,
  widgetVisible: false,
  widgetOpacity: 0.9,
}

export interface CodexUsageTrendPoint {
  date: string
  tokens: number
}

function currentLimit(state: CodexUsageState): CodexUsageLimit | null {
  const limits = state.rateLimits
  if (!limits) return null
  return limits.rateLimitsByLimitId?.codex ?? limits.rateLimits
}

function isLimit(value: CodexUsageLimit | undefined | null): value is CodexUsageLimit {
  return Boolean(value && typeof value === 'object')
}

/** Select distinct non-Codex limits without repeating the currently displayed Codex limit. */
export function additionalCodexUsageLimits(state: CodexUsageState): Array<{ key: string; limit: CodexUsageLimit }> {
  const primary = currentLimit(state)
  const entries = Object.entries(state.rateLimits?.rateLimitsByLimitId ?? {})
  const primaryId = String(primary?.limitId ?? '').trim().toLowerCase()
  const seen = new Set<string>()

  return entries.flatMap(([key, limit]) => {
    if (!isLimit(limit)) return []
    const entryKey = key.trim().toLowerCase()
    const limitId = String(limit.limitId ?? '').trim().toLowerCase()
    const identity = limitId || entryKey
    const isPrimary = entryKey === 'codex' || limit === primary || (primaryId && limitId === primaryId)
    if (isPrimary || seen.has(identity)) return []
    seen.add(identity)
    return [{ key, limit }]
  })
}

export function normalizedPercent(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(0, Math.min(100, numeric))
}

function windowTitle(usageWindow: CodexUsageWindow | null, fallback: string): string {
  const minutes = Number(usageWindow?.windowDurationMins)
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback
  if (minutes === 300) return '5 小时窗口'
  if (minutes === 10_080) return '周用量窗口'
  return `${Math.round(minutes)} 分钟窗口`
}

function resetMilliseconds(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
  return Number.isNaN(new Date(milliseconds).getTime()) ? null : milliseconds
}

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分`
  const days = Math.floor(hours / 24)
  return `${days} 天 ${hours % 24} 小时`
}

/** A countdown is used instead of a static reset time so returned windows remain actionable. */
export function formatResetCountdown(value: unknown, now = Date.now()): string {
  const resetsAt = resetMilliseconds(value)
  if (!resetsAt) return '重置时间未返回'
  if (resetsAt <= now) return '正在等待重置'
  return `距重置 ${formatElapsed(resetsAt - now)}`
}

function resetText(value: unknown, now: number): string {
  const resetsAt = resetMilliseconds(value)
  if (!resetsAt) return '重置时间未返回'
  return `${formatResetCountdown(resetsAt, now)} · ${formatDateTime(resetsAt)}`
}

function relativeTime(value: number, now: number): string {
  const age = Math.max(0, now - value)
  if (age < 5_000) return '刚刚'
  return `${formatElapsed(age)}前`
}

/** Distinguishes fresh data, stale data, and an error while retaining the last successful read. */
export function formatFreshness(connection: CodexUsageConnection, lastSuccessfulRefreshAt: unknown, now = Date.now()): string {
  const refreshedAt = Number(lastSuccessfulRefreshAt)
  const hasFreshTimestamp = Number.isFinite(refreshedAt) && refreshedAt > 0
  const previous = hasFreshTimestamp ? `上次成功刷新 ${formatDateTime(refreshedAt)}（${relativeTime(refreshedAt, now)}）` : '尚无成功刷新数据'

  if (connection === 'error') return `刷新失败，数据可能已过期 · ${previous}`
  if (!hasFreshTimestamp) return connection === 'ready' ? '已连接，正在等待用量数据' : previous
  if (now - refreshedAt > STALE_AFTER_MS) return `数据可能已过期 · ${previous}`
  return previous
}

function numericValue(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

/** Formats token quantities consistently without losing the unit on unavailable data. */
export function formatTokenCount(value: unknown): string {
  const numeric = numericValue(value)
  if (numeric === null) return '— tokens'
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(2)}M tokens`
  if (numeric >= 1_000) return `${(numeric / 1_000).toFixed(2)}K tokens`
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(numeric)} tokens`
}

function formatExactTokenCount(value: unknown): string {
  const numeric = numericValue(value)
  return numeric === null ? '— tokens' : `${new Intl.NumberFormat().format(numeric)} tokens`
}

function formatSeconds(value: number | string | null | undefined): string | null {
  const seconds = numericValue(value)
  if (seconds === null) return null
  return formatElapsed(seconds * 1000)
}

function startDateMilliseconds(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Keep only returned daily buckets; omitted days are never treated as zero-usage days. */
export function dailyUsageTrend(
  buckets: CodexTokenUsage['dailyUsageBuckets'],
  days: 7 | 30,
  now = Date.now(),
): CodexUsageTrendPoint[] {
  if (!Array.isArray(buckets)) return []
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - days + 1)
  const byDate = new Map<number, CodexUsageTrendPoint>()

  for (const bucket of buckets) {
    const timestamp = startDateMilliseconds(bucket?.startDate)
    const tokens = numericValue(bucket?.tokens)
    if (timestamp === null || tokens === null || timestamp < start.getTime() || timestamp > end.getTime()) continue
    const dateValue = new Date(timestamp)
    const date = `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, '0')}-${String(dateValue.getDate()).padStart(2, '0')}`
    const prior = byDate.get(timestamp)
    byDate.set(timestamp, { date, tokens: (prior?.tokens ?? 0) + tokens })
  }

  return [...byDate.entries()].sort(([left], [right]) => left - right).map(([, bucket]) => bucket)
}

function UsageBar({ label, usageWindow, now }: { label: string; usageWindow: CodexUsageWindow; now: number }) {
  const used = normalizedPercent(usageWindow.usedPercent)
  const remaining = used === null ? null : 100 - used
  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hair)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 9 }}>
        <span style={{ fontSize: 13, color: 'var(--text2)' }}>{windowTitle(usageWindow, label)}</span>
        <span style={{ fontFamily: MONO, color: 'var(--text)', fontSize: 13, fontWeight: 650 }}>
          {used === null ? '—' : `已用 ${Math.round(used)}% · 剩余 ${Math.round(remaining ?? 0)}%`}
        </span>
      </div>
      <div style={{ height: 8, overflow: 'hidden', borderRadius: 999, background: 'var(--pill)' }}>
        <div style={{ width: `${used ?? 0}%`, height: '100%', borderRadius: 'inherit', background: 'var(--accent)', transition: 'width .22s ease' }} />
      </div>
      <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text3)' }}>{resetText(usageWindow.resetsAt, now)}</div>
    </div>
  )
}

function UsageWindows({ limit, now }: { limit: CodexUsageLimit; now: number }) {
  const windows = [
    limit.primary ? { label: '主用量窗口', usageWindow: limit.primary } : null,
    limit.secondary ? { label: '次级用量窗口', usageWindow: limit.secondary } : null,
  ].filter((item): item is { label: string; usageWindow: CodexUsageWindow } => item !== null)

  if (!windows.length) return <div style={{ padding: 18, fontSize: 13, color: 'var(--text3)' }}>本机 Codex 未返回可显示的用量窗口。</div>
  return <>{windows.map((item) => <UsageBar key={item.label} {...item} now={now} />)}</>
}

export function codexUsageSummaryFacts(summary: CodexTokenUsage['summary']): Array<{ label: string; value: string }> {
  if (!summary) return []
  const facts: Array<{ label: string; value: string }> = []
  const addTokenCount = (label: string, value: number | string | null | undefined) => {
    if (numericValue(value) !== null) facts.push({ label, value: formatTokenCount(value) })
  }
  addTokenCount('累计 token', summary.lifetimeTokens)
  addTokenCount('单日峰值', summary.peakDailyTokens)
  const addNumber = (label: string, value: number | string | null | undefined, suffix: string) => {
    const numeric = numericValue(value)
    if (numeric !== null) facts.push({ label, value: `${new Intl.NumberFormat().format(numeric)}${suffix}` })
  }
  addNumber('当前连续使用', summary.currentStreakDays, ' 天')
  addNumber('最长连续使用', summary.longestStreakDays, ' 天')
  const longestTurn = formatSeconds(summary.longestRunningTurnSec)
  if (longestTurn !== null) facts.push({ label: '最长运行轮次', value: longestTurn })
  return facts
}

function TrendPanel({ range, onRangeChange, trend }: { range: 7 | 30; onRangeChange: (range: 7 | 30) => void; trend: CodexUsageTrendPoint[] }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(() => trend[trend.length - 1]?.date ?? null)
  const maxTokens = Math.max(...trend.map((item) => item.tokens), 1)
  const selectedPoint = trend.find((item) => item.date === selectedDate) ?? trend[trend.length - 1] ?? null

  // Keep a retained point selected across updates; fall back to the newest returned day when it disappears.
  useEffect(() => {
    setSelectedDate((previous) => trend.some((item) => item.date === previous) ? previous : trend[trend.length - 1]?.date ?? null)
  }, [trend])

  return (
    <Panel
      label="Token 趋势"
      right={
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {([7, 30] as const).map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={range === days}
              onClick={() => onRangeChange(days)}
              style={{ border: '1px solid var(--hair)', borderRadius: 7, padding: '3px 7px', color: range === days ? '#fff' : 'var(--text2)', background: range === days ? 'var(--accent)' : 'var(--pill)', cursor: 'pointer', fontSize: 11.5 }}
            >
              {days} 天
            </button>
          ))}
        </span>
      }
      flex={false}
    >
      {trend.length ? (
        <div style={{ padding: '14px 16px' }}>
          <div style={{ height: 76, display: 'flex', alignItems: 'flex-end', gap: range === 30 ? 2 : 5 }} role="group" aria-label={`近 ${range} 天 token 趋势`}>
            {trend.map((item) => {
              const isSelected = item.date === selectedPoint?.date
              const fullLabel = `${item.date} · ${formatTokenCount(item.tokens)}（完整数值：${formatExactTokenCount(item.tokens)}）`
              return (
                <button
                  key={item.date}
                  type="button"
                  title={fullLabel}
                  aria-label={fullLabel}
                  aria-pressed={isSelected}
                  onPointerEnter={() => setSelectedDate(item.date)}
                  onFocus={() => setSelectedDate(item.date)}
                  onClick={() => setSelectedDate(item.date)}
                  style={{ flex: 1, minWidth: 2, alignSelf: 'flex-end', height: `${Math.max(4, Math.round((item.tokens / maxTokens) * 100))}%`, padding: 0, border: 0, borderRadius: '3px 3px 1px 1px', background: 'var(--accent)', cursor: 'pointer', opacity: isSelected ? 1 : .72, boxShadow: isSelected ? '0 0 0 1px var(--text)' : 'none', transition: 'height .18s ease, opacity .18s ease, box-shadow .18s ease' }}
                />
              )
            })}
          </div>
          {selectedPoint && <div role="status" aria-live="polite" style={{ marginTop: 9, fontSize: 12, color: 'var(--text2)' }}>已选 {selectedPoint.date} · <span style={{ fontFamily: MONO, color: 'var(--text)', fontWeight: 650 }}>{formatTokenCount(selectedPoint.tokens)}（{formatExactTokenCount(selectedPoint.tokens)}）</span></div>}
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11.5, color: 'var(--text3)' }}>
            <span>{trend[0]?.date}</span>
            <span>峰值 {formatTokenCount(maxTokens)}</span>
            <span>{trend[trend.length - 1]?.date}</span>
          </div>
        </div>
      ) : (
        <div style={{ padding: 18, fontSize: 13, color: 'var(--text3)' }}>本机 Codex 未返回近 {range} 天的日用量数据。</div>
      )}
    </Panel>
  )
}

function CodexUsageTool() {
  const api = platform.codexUsage
  const [state, setState] = useState<CodexUsageState>(EMPTY_STATE)
  const [busy, setBusy] = useState(false)
  const [trendRange, setTrendRange] = useState<7 | 30>(7)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!api) return
    let mounted = true
    const off = api.onState((next) => {
      if (mounted) setState(next)
    })
    void api.getState().then((next) => {
      if (mounted) setState(next)
    })
    return () => {
      mounted = false
      off()
      void api.release()
    }
  }, [api])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const limit = useMemo(() => currentLimit(state), [state])
  const additionalLimits = useMemo(() => additionalCodexUsageLimits(state), [state])
  const trend = useMemo(() => dailyUsageTrend(state.usage?.dailyUsageBuckets ?? null, trendRange, now), [state.usage?.dailyUsageBuckets, trendRange, now])
  const facts = useMemo(() => codexUsageSummaryFacts(state.usage?.summary ?? null), [state.usage?.summary])
  const unavailable = !api
  const statusText = unavailable
    ? '仅桌面版可读取本机 Codex 状态'
    : state.connection === 'ready'
    ? '已连接本机 Codex'
    : state.connection === 'error'
    ? state.error || '无法读取 Codex 状态'
    : state.connection === 'idle'
    ? '打开本页时按需读取；关闭后会释放资源'
    : '正在连接本机 Codex…'

  async function run(action: () => Promise<CodexUsageState>) {
    if (!api || busy) return
    setBusy(true)
    try {
      setState(await action())
    } finally {
      setBusy(false)
    }
  }

  function setWidgetOpacity(opacity: number) {
    if (!api) return
    setState((previous) => ({ ...previous, widgetOpacity: opacity }))
    void api.setWidgetOpacity(opacity).then(setState).catch(() => {
      void api.getState().then(setState).catch(() => {})
    })
  }

  const actionLabel = state.enabled ? '关闭常驻' : '启用常驻'

  return (
    <ToolPage scroll>
      <ToolHeader
        glyph="◒"
        hue="green"
        title="Codex 用量状态"
        subtitle="按需读取本机 Codex 的限额与令牌用量；不会访问或显示登录凭据"
        right={!unavailable ? <ActionPill primary onClick={() => void run(() => api.setEnabled(!state.enabled))}>{actionLabel}</ActionPill> : undefined}
      />

      <div style={{ padding: '14px 16px', borderRadius: 14, background: 'var(--surface2)', border: '1px solid var(--hair)', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text)' }}>{statusText}</div>
            <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--text3)' }}>
              {unavailable ? '该内置工具需要运行在 TTool 桌面版中。' : `${formatFreshness(state.connection, state.lastSuccessfulRefreshAt, now)} · ${state.enabled ? '常驻状态窗已启用，可从顶部“拖动此处”移动。' : '未启用常驻状态窗。'}`}
            </div>
          </div>
          {!unavailable && <ActionPill onClick={() => void run(() => api.refresh())}>{busy ? '刷新中…' : '刷新'}</ActionPill>}
        </div>
      </div>

      <Panel
        label={limit?.limitName ? `${limit.limitName} 当前用量` : '当前用量'}
        right={limit?.planType ? <span style={{ color: 'var(--text3)', fontFamily: MONO, fontSize: 11 }}>{limit.planType}</span> : undefined}
        flex={false}
      >
        {unavailable ? <div style={{ padding: 18, fontSize: 13, color: 'var(--text2)' }}>该内置工具需要运行在 TTool 桌面版中。</div> : limit ? <UsageWindows limit={limit} now={now} /> : <div style={{ padding: 18, fontSize: 13, color: 'var(--text3)' }}>正在等待本机 Codex 返回用量窗口。</div>}
      </Panel>

      {additionalLimits.map(({ key, limit: additional }) => (
        <div key={key} style={{ marginTop: 16 }}>
          <Panel label={additional.limitName || additional.limitId || key} right={additional.planType ? <span style={{ color: 'var(--text3)', fontFamily: MONO, fontSize: 11 }}>{additional.planType}</span> : undefined} flex={false}>
            <UsageWindows limit={additional} now={now} />
          </Panel>
        </div>
      ))}

      {!unavailable && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', alignItems: 'stretch', gap: 16, marginTop: 16 }}>
          <TrendPanel range={trendRange} onRangeChange={setTrendRange} trend={trend} />
          {facts.length > 0 && (
            <Panel label="用量摘要" flex={false}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, background: 'var(--hair)' }}>
                {facts.map((fact) => (
                  <div key={fact.label} style={{ padding: '14px 16px', background: 'var(--surface)' }}>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{fact.label}</div>
                    <div style={{ marginTop: 5, fontFamily: MONO, fontSize: 16, fontWeight: 650, color: 'var(--text)' }}>{fact.value}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          <Panel label="桌面状态窗" flex={false}>
            <div style={{ padding: '15px 16px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, minWidth: 260 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{state.widgetVisible ? '当前正在桌面显示' : '当前未显示'}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <ActionPill onClick={() => void run(() => api.showWidget())}>显示</ActionPill>
                {state.widgetVisible && <ActionPill onClick={() => void run(() => api.hideWidget())}>隐藏</ActionPill>}
              </div>
              <label style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text2)' }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>不透明度</span>
                  <span style={{ fontFamily: MONO, color: 'var(--text)' }}>{Math.round(state.widgetOpacity * 100)}%</span>
                </span>
                <input type="range" min="50" max="100" step="5" value={Math.round(state.widgetOpacity * 100)} aria-label="桌面状态窗不透明度" onChange={(event) => setWidgetOpacity(Number(event.currentTarget.value) / 100)} style={{ width: '100%' }} />
              </label>
              <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--text3)' }}>调整会立即应用到已显示的状态窗，并在重启后保留。</span>
            </div>
          </Panel>
        </div>
      )}
    </ToolPage>
  )
}

registerTool({
  id: 'codex-usage',
  name: 'Codex 用量状态',
  desc: '查看本机 Codex 限额并按需常驻桌面',
  glyph: '◒',
  cat: '开发',
  hue: 'green',
  order: 35,
  keywords: 'codex usage rate limit quota token 用量 限额',
  component: CodexUsageTool,
})
