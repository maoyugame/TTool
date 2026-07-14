import { useEffect, useMemo, useState } from 'react'
import { platform } from '../../platform'
import type { CodexUsageLimit, CodexUsageState, CodexUsageWindow } from '../../platform/types'
import { registerTool } from '../registry'
import { ActionPill, MONO, Panel, ToolHeader, ToolPage } from '../ui'

const EMPTY_STATE: CodexUsageState = {
  connection: 'idle',
  error: null,
  updatedAt: null,
  rateLimits: null,
  usage: null,
  enabled: false,
  widgetVisible: false,
}

function currentLimit(state: CodexUsageState): CodexUsageLimit | null {
  const limits = state.rateLimits
  if (!limits) return null
  return limits.rateLimitsByLimitId?.codex ?? limits.rateLimits
}

function windowTitle(window: CodexUsageWindow | null, fallback: string): string {
  if (!window?.windowDurationMins) return fallback
  if (window.windowDurationMins === 300) return '5 小时窗口'
  if (window.windowDurationMins === 10_080) return '周用量窗口'
  return `${Math.round(window.windowDurationMins)} 分钟窗口`
}

function resetText(value: number | null | undefined): string {
  if (!value) return '重置时间未知'
  const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime())) return '重置时间未知'
  return `重置于 ${date.toLocaleString()}`
}

function percent(value: CodexUsageWindow | null): string {
  return value ? `${Math.round(Math.max(0, Math.min(100, value.usedPercent || 0)))}%` : '—'
}

function numberText(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  return Number.isFinite(num) ? new Intl.NumberFormat().format(num) : String(value)
}

function UsageBar({ label, window }: { label: string; window: CodexUsageWindow | null }) {
  const used = Math.max(0, Math.min(100, window?.usedPercent || 0))
  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hair)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 9 }}>
        <span style={{ fontSize: 13, color: 'var(--text2)' }}>{windowTitle(window, label)}</span>
        <span style={{ fontFamily: MONO, color: 'var(--text)', fontSize: 17, fontWeight: 700 }}>{percent(window)}</span>
      </div>
      <div style={{ height: 8, overflow: 'hidden', borderRadius: 999, background: 'var(--pill)' }}>
        <div style={{ width: `${used}%`, height: '100%', borderRadius: 'inherit', background: 'var(--accent)', transition: 'width .22s ease' }} />
      </div>
      <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text3)' }}>{resetText(window?.resetsAt)}</div>
    </div>
  )
}

function CodexUsageTool() {
  const api = platform.codexUsage
  const [state, setState] = useState<CodexUsageState>(EMPTY_STATE)
  const [busy, setBusy] = useState(false)

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

  const limit = useMemo(() => currentLimit(state), [state])
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

  const actionLabel = state.enabled ? '关闭常驻' : '启用常驻'

  return (
    <ToolPage scroll>
      <ToolHeader
        glyph="◒"
        hue="green"
        title="Codex 用量状态"
        subtitle="按需读取本机 Codex 的限额与令牌用量；不会访问或显示登录凭据"
        right={
          !unavailable ? <ActionPill primary onClick={() => void run(() => api.setEnabled(!state.enabled))}>{actionLabel}</ActionPill> : undefined
        }
      />

      <div style={{ padding: '14px 16px', borderRadius: 14, background: 'var(--surface2)', border: '1px solid var(--hair)', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text)' }}>{statusText}</div>
            <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--text3)' }}>
              {state.enabled ? '已启用：透明、置顶、鼠标穿透的桌面状态窗会保持显示。' : '未启用：应用启动时不会创建常驻窗或 Codex 子进程。'}
            </div>
          </div>
          {!unavailable && <ActionPill onClick={() => void run(() => api.refresh())}>{busy ? '刷新中…' : '刷新'}</ActionPill>}
        </div>
      </div>

      <Panel
        label="当前用量"
        right={limit?.planType ? <span style={{ color: 'var(--text3)', fontFamily: MONO, fontSize: 11 }}>{limit.planType}</span> : undefined}
        flex={false}
      >
        {unavailable ? (
          <div style={{ padding: 18, fontSize: 13, color: 'var(--text2)' }}>该内置工具需要运行在 TTool 桌面版中。</div>
        ) : (
          <>
            <UsageBar label="主用量窗口" window={limit?.primary ?? null} />
            <UsageBar label="次级用量窗口" window={limit?.secondary ?? null} />
          </>
        )}
      </Panel>

      {!unavailable && (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 16, marginTop: 16 }}>
          <Panel label="账号累计" flex={false}>
            <div style={{ padding: '15px 16px', minWidth: 210 }}>
              <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{numberText(state.usage?.summary?.lifetimeTokens)}</div>
              <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--text3)' }}>累计 token（由本机 Codex 返回）</div>
            </div>
          </Panel>
          <Panel label="桌面状态窗" flex={false}>
            <div style={{ padding: '15px 16px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{state.widgetVisible ? '当前正在桌面显示' : '当前未显示'}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <ActionPill onClick={() => void run(() => api.showWidget())}>显示</ActionPill>
                {state.widgetVisible && <ActionPill onClick={() => void run(() => api.hideWidget())}>隐藏</ActionPill>}
              </div>
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
