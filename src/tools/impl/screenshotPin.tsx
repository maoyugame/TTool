import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from 'react'
import { registerTool } from '../registry'
import { ToolPage, ToolHeader, Panel, Seg, MONO } from '../ui'
import { platform } from '../../platform'
import { screenshotHost } from '../../platform/screenshot'
import { useToolbox } from '../../store/toolbox'
import type {
  ScreenshotCapture,
  ScreenshotEnvironment,
  ScreenshotPinInfo,
  ScreenshotRecentItem,
  ScreenshotShortcutConfig,
  ScreenshotShortcutKey,
  ScreenshotShortcutStatus,
} from '../../platform/types'

const DEFAULT_CONFIG: ScreenshotShortcutConfig = {
  enabled: false,
  screenshot: 'Control+Alt+A',
  screenshotPin: 'Control+Alt+S',
}

const TOOL_ID = 'screenshot-pin'
const RESERVED = new Set(['Alt+Space', 'Control+Alt+Space'].map(shortcutId))

type AnnotationTool = 'select' | 'arrow' | 'rect' | 'circle' | 'brush' | 'text' | 'mosaic' | 'pan'
type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type AnnotationShape =
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; color: string; lineWidth: number }
  | { kind: 'circle'; x: number; y: number; width: number; height: number; color: string; lineWidth: number }
  | { kind: 'brush'; points: Point[]; color: string; width: number }
  | { kind: 'text'; x: number; y: number; text: string; color: string; fontSize: number }
  | { kind: 'mosaic'; points: Point[]; size: number; block: number }
type Annotation = AnnotationShape & { id: string }
type ViewMode = 'fit' | 'manual'
type EditorInteraction =
  | { kind: 'draw' }
  | { kind: 'marquee'; start: Point; current: Point; mode: SelectionMode }
  | { kind: 'move'; ids: string[]; start: Point; current: Point; origin: Annotation[]; moved: boolean }
  | { kind: 'pan'; startClient: Point; scrollLeft: number; scrollTop: number }
type SelectionMode = 'replace' | 'add' | 'toggle'

type TextDraft = { id: number; x: number; y: number; text: string; createdAt: number; appendToCurrentUndo?: boolean; protectInitialBlur?: boolean }

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const ZOOM_STEP = 1.25
const SELECT_COLOR = '#35d5c7'

const buttonStyle: CSSProperties = {
  height: 34,
  border: '1px solid var(--hair)',
  borderRadius: 10,
  padding: '0 12px',
  background: 'var(--pill)',
  color: 'var(--text)',
  fontSize: 12.5,
  fontWeight: 560,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  borderColor: 'transparent',
  background: 'var(--accent)',
  color: '#fff',
}

const fieldStyle: CSSProperties = {
  height: 34,
  border: '1px solid var(--fieldHair)',
  borderRadius: 10,
  background: 'var(--field)',
  color: 'var(--text)',
  padding: '0 10px',
}

const pageLayoutCss = `
.screenshot-pin-shell {
  display: grid;
  gap: 14px;
}
.screenshot-pin-status-bar {
  display: grid;
  grid-template-columns: minmax(220px, .86fr) minmax(460px, 1.4fr) auto;
  align-items: start;
  gap: 14px;
  padding: 14px;
  min-height: 94px;
  box-sizing: border-box;
}
.screenshot-pin-status-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.screenshot-pin-status-title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
  font-size: 13.5px;
  font-weight: 650;
}
.screenshot-pin-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.screenshot-pin-status-message {
  color: var(--text2);
  font-size: 12.5px;
  line-height: 1.5;
}
.screenshot-pin-status-message.is-error {
  color: #ff8d8d;
}
.screenshot-pin-shortcuts {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(220px, 1fr));
  gap: 10px;
  align-items: start;
}
.screenshot-pin-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.screenshot-pin-status-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.screenshot-pin-workbench {
  display: grid;
  grid-template-columns: minmax(240px, 280px) minmax(520px, 1fr) minmax(260px, 320px);
  gap: 14px;
  align-items: start;
}
.screenshot-pin-left,
.screenshot-pin-center,
.screenshot-pin-right {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.screenshot-pin-center {
  align-self: stretch;
}
.screenshot-pin-recent-grid,
.screenshot-pin-pin-list {
  display: grid;
  gap: 10px;
}
.screenshot-pin-recent-grid {
  grid-template-columns: 1fr;
}
.screenshot-pin-recent-card,
.screenshot-pin-pin-card {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--hair);
  border-radius: 12px;
  background: var(--surface3);
  box-sizing: border-box;
}
.screenshot-pin-thumb,
.screenshot-pin-thumb-pin {
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--hair);
}
.screenshot-pin-thumb,
.screenshot-pin-thumb-pin {
  width: 82px;
  height: 58px;
}
.screenshot-pin-card-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.screenshot-pin-card-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.screenshot-pin-card-title {
  min-width: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.screenshot-pin-card-time {
  flex: 0 0 auto;
  color: var(--text3);
  font-size: 12px;
}
.screenshot-pin-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.screenshot-pin-card-actions button {
  height: 30px !important;
  padding: 0 9px !important;
  font-size: 12px !important;
}
.screenshot-pin-recent-grid {
  max-height: min(48vh, 520px);
  overflow: auto;
  padding-right: 2px;
}
.screenshot-pin-pin-list {
  max-height: min(48vh, 520px);
  overflow: auto;
  padding-right: 2px;
}
.screenshot-pin-shortcut-row {
  display: grid;
  grid-template-columns: auto minmax(112px, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 9px;
  border: 1px solid var(--hair);
  border-radius: 12px;
  background: var(--surface3);
}
.screenshot-pin-shortcut-row-status {
  grid-column: 2 / -1;
  color: var(--text3);
  font-size: 12px;
  line-height: 1.35;
}
.screenshot-pin-empty-editor {
  min-height: 210px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 22px;
  color: var(--text2);
}
@media (max-width: 1200px) {
  .screenshot-pin-workbench {
    grid-template-columns: minmax(0, 1fr);
  }
  .screenshot-pin-center {
    order: 1;
  }
  .screenshot-pin-left,
  .screenshot-pin-right {
    order: 2;
  }
  .screenshot-pin-left,
  .screenshot-pin-right {
    display: grid;
  }
  .screenshot-pin-left .screenshot-pin-recent-grid,
  .screenshot-pin-right .screenshot-pin-pin-list {
    max-height: none;
  }
  .screenshot-pin-status-bar {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .screenshot-pin-shortcuts {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .screenshot-pin-actions {
    grid-column: 2;
    grid-row: 1;
  }
  .screenshot-pin-recent-card,
  .screenshot-pin-pin-card {
    grid-template-columns: 96px minmax(0, 1fr);
  }
  .screenshot-pin-thumb,
  .screenshot-pin-thumb-pin {
    width: 96px;
    height: 64px;
  }
}
@media (min-width: 721px) and (max-width: 1200px) {
  .screenshot-pin-workbench {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .screenshot-pin-center {
    grid-column: 1 / -1;
  }
}
@media (max-width: 760px) {
  .screenshot-pin-workbench {
    grid-template-columns: 1fr;
  }
  .screenshot-pin-center,
  .screenshot-pin-left,
  .screenshot-pin-right {
    grid-column: auto;
  }
  .screenshot-pin-status-bar {
    grid-template-columns: 1fr;
  }
  .screenshot-pin-actions {
    justify-content: flex-start;
    grid-column: auto;
    grid-row: auto;
  }
  .screenshot-pin-shortcuts {
    grid-template-columns: 1fr;
    grid-column: auto;
    grid-row: auto;
  }
  .screenshot-pin-recent-card,
  .screenshot-pin-pin-card {
    grid-template-columns: 82px minmax(0, 1fr);
  }
  .screenshot-pin-thumb,
  .screenshot-pin-thumb-pin {
    width: 82px;
    height: 58px;
  }
  .screenshot-pin-shortcut-row {
    grid-template-columns: 1fr auto auto;
  }
  .screenshot-pin-shortcut-row > span:first-child {
    grid-column: 1 / -1;
  }
  .screenshot-pin-shortcut-row-status {
    grid-column: 1 / -1;
  }
}
`

function Button({ children, primary, disabled, onClick, title }: { children: ReactNode; primary?: boolean; disabled?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...(primary ? primaryButtonStyle : buttonStyle),
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function Chip({ children, good, bad }: { children: ReactNode; good?: boolean; bad?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 28,
        borderRadius: 999,
        padding: '0 10px',
        fontSize: 12,
        fontWeight: 620,
        whiteSpace: 'nowrap',
        color: bad ? '#ff8d8d' : good ? 'var(--good)' : 'var(--text2)',
        background: bad ? 'rgba(255, 90, 90, .12)' : good ? 'rgba(58, 208, 122, .12)' : 'var(--pill)',
      }}
    >
      {children}
    </span>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 48,
        height: 28,
        border: '1px solid var(--hair)',
        borderRadius: 999,
        padding: 3,
        background: checked ? 'var(--accent)' : 'var(--pill)',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          display: 'block',
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          transform: checked ? 'translateX(20px)' : 'translateX(0)',
          transition: 'transform .16s ease',
        }}
      />
    </button>
  )
}

function shortcutId(acc: string): string {
  const mods: string[] = []
  const main: string[] = []
  for (const part of acc.split('+').map((p) => p.trim()).filter(Boolean)) {
    const low = part.toLowerCase()
    if (low === 'ctrl' || low === 'control') mods.push('control')
    else if (low === 'cmd' || low === 'command') mods.push('command')
    else if (low === 'cmdorctrl' || low === 'commandorcontrol') mods.push('commandorcontrol')
    else if (low === 'option') mods.push('alt')
    else if (low === 'alt' || low === 'shift' || low === 'meta' || low === 'super') mods.push(low)
    else if (low === ' ') main.push('space')
    else main.push(low)
  }
  const order = ['commandorcontrol', 'command', 'control', 'alt', 'shift', 'meta', 'super']
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return [...mods, ...main].join('+')
}

function eventToAccelerator(e: KeyboardEvent): string | null {
  const key = e.key
  if (key === 'Escape') return 'Escape'
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.metaKey) mods.push('Meta')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const modifierKeys = new Set(['Control', 'Shift', 'Alt', 'Meta'])
  if (modifierKeys.has(key)) return null
  let main = ''
  if (key === ' ') main = 'Space'
  else if (/^[a-z]$/i.test(key)) main = key.toUpperCase()
  else if (/^[0-9]$/.test(key)) main = key
  else if (/^F\d{1,2}$/i.test(key)) main = key.toUpperCase()
  else {
    const map: Record<string, string> = {
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Enter: 'Enter',
      Tab: 'Tab',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Insert: 'Insert',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
    }
    main = map[key] || ''
  }
  if (!main || !mods.length) return null
  return [...mods, main].join('+')
}

function validateLocalConfig(config: ScreenshotShortcutConfig): string {
  const a = shortcutId(config.screenshot)
  const b = shortcutId(config.screenshotPin)
  if (a === b) return '两个截图快捷键不能相同'
  if (RESERVED.has(a) || RESERVED.has(b)) return '快捷键与 TTool 全局启动器快捷键冲突'
  return ''
}

function statusFor(statuses: ScreenshotShortcutStatus[], key: ScreenshotShortcutKey) {
  return statuses.find((s) => s.key === key)
}

function fmtTime(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function permissionText(env: ScreenshotEnvironment | null) {
  if (!env) return '检测中'
  if (env.permission === 'granted') return '权限可用'
  if (env.permission === 'denied' || env.permission === 'restricted' || env.permission === 'not-determined') return '需要屏幕录制权限'
  return '权限状态未知'
}

function dimensionsText(item: { width: number; height: number }) {
  return `${item.width} × ${item.height}px`
}

function ScreenshotPinTool() {
  const { flash } = useToolbox()
  const api = screenshotHost
  const [env, setEnv] = useState<ScreenshotEnvironment | null>(null)
  const [config, setConfig] = useState<ScreenshotShortcutConfig>(DEFAULT_CONFIG)
  const [statuses, setStatuses] = useState<ScreenshotShortcutStatus[]>([])
  const [pins, setPins] = useState<ScreenshotPinInfo[]>([])
  const [recents, setRecents] = useState<ScreenshotRecentItem[]>([])
  const [capture, setCapture] = useState<ScreenshotCapture | null>(null)
  const [latest, setLatest] = useState('')
  const [error, setError] = useState('')
  const [recording, setRecording] = useState<ScreenshotShortcutKey | null>(null)

  const enabledOk = config.enabled && statuses.length > 0 && statuses.every((s) => s.registered)
  const totalStatus = config.enabled ? (enabledOk ? '已启用' : '部分快捷键不可用') : '已关闭'

  const receiveCapture = useCallback(
    (item: ScreenshotCapture) => {
      setCapture(item)
      setLatest(item.source === 'pin-annotate' ? '正在标注贴图' : '已进入标注')
      void api?.ackCapture(item.id)
    },
    [api]
  )

  const refresh = useCallback(async () => {
    if (!api) return
    const [nextEnv, nextConfig, nextPins, nextRecents, pending] = await Promise.all([
      api.getEnvironment(),
      api.getConfig(),
      api.listPins(),
      api.listRecentScreenshots(),
      api.consumeCaptures(),
    ])
    setEnv(nextEnv)
    setConfig(nextConfig.config)
    setStatuses(nextConfig.statuses)
    setPins(nextPins)
    setRecents(nextRecents)
    pending.forEach(receiveCapture)
  }, [api, receiveCapture])

  useEffect(() => {
    if (!api) return
    void refresh()
    const offCapture = api.onCapture(receiveCapture)
    const offPins = api.onPinsChanged(setPins)
    const offRecents = api.onRecentScreenshotsChanged(setRecents)
    const offStatus = api.onStatus((s) => {
      setLatest(s.message)
      setError(s.level === 'error' ? s.message : '')
      if (s.level === 'info') flash(s.message)
    })
    return () => {
      offCapture()
      offPins()
      offRecents()
      offStatus()
    }
  }, [api, flash, receiveCapture, refresh])

  const applyConfig = useCallback(
    async (next: ScreenshotShortcutConfig) => {
      if (!api) return
      const localError = validateLocalConfig(next)
      if (localError) {
        setError(localError)
        return
      }
      const result = await api.setConfig(next)
      setConfig(result.config)
      setStatuses(result.statuses)
      setError(result.ok ? '' : result.error || '快捷键注册失败，已保留原快捷键')
      setLatest(result.ok ? (result.config.enabled ? '快捷键已注册' : '已关闭') : '快捷键被占用，已保留原快捷键')
    },
    [api]
  )

  const startCapture = useCallback(
    async (action: 'edit' | 'pin') => {
      if (!api) return
      setError('')
      const result = await api.startCapture(action)
      if (!result.ok) {
        setError(result.error || '截图失败，请重试')
        setLatest(result.error || '截图失败，请重试')
      } else {
        setLatest('截图进行中')
      }
    },
    [api]
  )

  const saveShortcut = useCallback(
    (key: ScreenshotShortcutKey, accelerator: string) => {
      const next = { ...config, [key]: accelerator }
      void applyConfig(next)
    },
    [applyConfig, config]
  )

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const acc = eventToAccelerator(e)
      if (acc === 'Escape') {
        setRecording(null)
        return
      }
      if (!acc) {
        setError('快捷键需要至少一个修饰键和一个主键')
        return
      }
      saveShortcut(recording, acc)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, saveShortcut])

  if (!api) {
    return (
      <ToolPage scroll>
        <ToolHeader glyph="截" hue="teal" title="截图贴图" subtitle="截图 · 标注 · 置顶贴图" right={<Chip bad>桌面能力不可用</Chip>} />
        <Panel label="状态" flex={false}>
          <div style={{ padding: 18, color: 'var(--text2)', fontSize: 13.5 }}>请在 TTool 桌面版中使用。</div>
        </Panel>
      </ToolPage>
    )
  }

  return (
    <ToolPage scroll>
      <style>{pageLayoutCss}</style>
      <ToolHeader
        glyph="截"
        hue="teal"
        title="截图贴图"
        subtitle="截图 · 标注 · 置顶贴图"
        right={<Chip good={enabledOk} bad={config.enabled && !enabledOk}>{totalStatus}</Chip>}
      />

      <div className="screenshot-pin-shell">
        <StatusActionBar
          env={env}
          config={config}
          statuses={statuses}
          latest={latest}
          error={error}
          onShot={() => void startCapture('edit')}
          onPin={() => void startCapture('pin')}
          disabled={!config.enabled}
          onToggleEnabled={(v) => void applyConfig({ ...config, enabled: v })}
          recording={recording}
          onRecord={setRecording}
          onReset={(key) => saveShortcut(key, DEFAULT_CONFIG[key])}
        />

        <div className="screenshot-pin-workbench">
          <div className="screenshot-pin-left">
            <RecentScreenshotsPanel
              items={recents}
              onOpen={(item) => {
                setCapture({ ...item, source: 'screenshot' })
                setLatest('已打开最近截图')
              }}
              onPin={(item) => void api.createPin(item.imageDataUrl, { displayId: item.displayId }).then((r) => flash(r.ok ? '已创建贴图' : r.error || '贴图失败'))}
              onCopy={(item) => void api.copyImage(item.imageDataUrl).then((r) => flash(r.ok ? '图片已复制' : r.error || '复制失败'))}
              onDelete={(id) => void api.deleteRecentScreenshot(id).then((r) => flash(r.ok ? '已删除最近截图' : r.error || '删除失败'))}
              onShot={() => void startCapture('edit')}
              disabled={!config.enabled}
            />
          </div>

          <div className="screenshot-pin-center">
            {capture ? (
              <AnnotationEditor
                capture={capture}
                onCancel={() => setCapture(null)}
                onDone={() => {
                  setCapture(null)
                  void refresh()
                }}
              />
            ) : (
              <EmptyEditor onShot={() => void startCapture('edit')} onPin={() => void startCapture('pin')} disabled={!config.enabled} />
            )}
          </div>

          <div className="screenshot-pin-right">
            <PinsPanel
              pins={pins}
              onPin={() => void startCapture('pin')}
              onFocus={(id) => void api.focusPin(id)}
              onToggleVisible={(pin) => void api.setPinVisible(pin.id, !pin.visible)}
              onAnnotate={(id) => void api.annotatePin(id)}
              onCopy={(pin) => void api.copyImage(pin.imageDataUrl).then((r) => flash(r.ok ? '图片已复制' : r.error || '复制失败'))}
              onSave={(pin) => void api.saveImage(pin.imageDataUrl, 'ttool-pin.png').then((r) => !r.canceled && flash(r.ok ? '图片已保存' : r.error || '保存失败'))}
              onClose={(id) => void api.closePin(id)}
              onCloseAll={() => void api.closeAllPins()}
            />
          </div>
        </div>
      </div>
    </ToolPage>
  )
}

function RecentScreenshotsPanel({
  items,
  onOpen,
  onPin,
  onCopy,
  onDelete,
  onShot,
  disabled,
}: {
  items: ScreenshotRecentItem[]
  onOpen: (item: ScreenshotRecentItem) => void
  onPin: (item: ScreenshotRecentItem) => void
  onCopy: (item: ScreenshotRecentItem) => void
  onDelete: (id: string) => void
  onShot: () => void
  disabled: boolean
}) {
  return (
    <Panel label="最近截图" right={<Chip>{items.length}/5</Chip>} flex={false}>
      <div style={{ padding: 14 }}>
        {!items.length ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, color: 'var(--text2)', fontSize: 13 }}>
            <span>暂无最近截图</span>
            <Button primary disabled={disabled} onClick={onShot}>截图</Button>
          </div>
        ) : (
          <div className="screenshot-pin-recent-grid">
            {items.map((item) => (
              <div key={item.id} className="screenshot-pin-recent-card">
                <img className="screenshot-pin-thumb" src={item.imageDataUrl} alt="" />
                <div className="screenshot-pin-card-body">
                  <div className="screenshot-pin-card-meta">
                    <span className="screenshot-pin-card-title">{dimensionsText(item)}</span>
                    <span className="screenshot-pin-card-time">{fmtTime(item.createdAt)}</span>
                  </div>
                  <div className="screenshot-pin-card-actions">
                    <Button primary onClick={() => onOpen(item)}>打开</Button>
                    <Button onClick={() => onPin(item)}>贴图</Button>
                    <Button onClick={() => onCopy(item)}>复制</Button>
                    <Button onClick={() => onDelete(item.id)}>删除</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

function StatusActionBar({
  env,
  config,
  statuses,
  latest,
  error,
  onShot,
  onPin,
  disabled,
  onToggleEnabled,
  recording,
  onRecord,
  onReset,
}: {
  env: ScreenshotEnvironment | null
  config: ScreenshotShortcutConfig
  statuses: ScreenshotShortcutStatus[]
  latest: string
  error: string
  onShot: () => void
  onPin: () => void
  disabled: boolean
  onToggleEnabled: (enabled: boolean) => void
  recording: ScreenshotShortcutKey | null
  onRecord: (key: ScreenshotShortcutKey | null) => void
  onReset: (key: ScreenshotShortcutKey) => void
}) {
  return (
    <Panel label="状态与操作" flex={false}>
      <div className="screenshot-pin-status-bar">
        <div className="screenshot-pin-status-main">
          <div className="screenshot-pin-status-title">
            <span>截图贴图</span>
            <Chip good={config.enabled} bad={!config.enabled}>{config.enabled ? '已启用' : '已关闭'}</Chip>
          </div>
          <div className="screenshot-pin-chip-row">
            <Chip good={platform.isDesktop}>桌面运行时</Chip>
            <Chip good={env?.permission === 'granted'} bad={permissionText(env) === '需要屏幕录制权限'}>{permissionText(env)}</Chip>
            <Chip>{env ? `${env.displays.length} 个显示器` : '显示器检测中'}</Chip>
          </div>
          {(latest || error) && (
            <div className={`screenshot-pin-status-message${error ? ' is-error' : ''}`}>
              {error || latest}
            </div>
          )}
        </div>
        <ShortcutInlineBar
          config={config}
          statuses={statuses}
          recording={recording}
          onRecord={onRecord}
          onReset={onReset}
        />
        <div className="screenshot-pin-actions">
          <div className="screenshot-pin-status-actions">
            <Toggle checked={config.enabled} onChange={onToggleEnabled} />
            <Button primary disabled={disabled} onClick={onShot}>截图</Button>
            <Button disabled={disabled} onClick={onPin}>截图并贴图</Button>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function ShortcutInlineBar({
  config,
  statuses,
  recording,
  onRecord,
  onReset,
}: {
  config: ScreenshotShortcutConfig
  statuses: ScreenshotShortcutStatus[]
  recording: ScreenshotShortcutKey | null
  onRecord: (key: ScreenshotShortcutKey | null) => void
  onReset: (key: ScreenshotShortcutKey) => void
}) {
  return (
    <div className="screenshot-pin-shortcuts" aria-label="快捷键">
      <ShortcutRow label="截图" value={config.screenshot} status={statusFor(statuses, 'screenshot')} active={recording === 'screenshot'} enabled={config.enabled} onRecord={() => onRecord('screenshot')} onReset={() => onReset('screenshot')} />
      <ShortcutRow label="截图并贴图" value={config.screenshotPin} status={statusFor(statuses, 'screenshotPin')} active={recording === 'screenshotPin'} enabled={config.enabled} onRecord={() => onRecord('screenshotPin')} onReset={() => onReset('screenshotPin')} />
    </div>
  )
}

function ShortcutRow({
  label,
  value,
  status,
  active,
  enabled,
  onRecord,
  onReset,
}: {
  label: string
  value: string
  status?: ScreenshotShortcutStatus
  active: boolean
  enabled: boolean
  onRecord: () => void
  onReset: () => void
}) {
  const statusText = active ? '正在录制，按 Esc 取消' : !enabled ? '已停用' : status?.registered ? '已注册' : status?.error || '未注册'
  const statusColor = enabled && status?.error ? '#ff8d8d' : enabled && status?.registered ? 'var(--good)' : undefined
  return (
    <div className="screenshot-pin-shortcut-row">
      <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 650 }}>{label}</span>
      <span style={{ ...fieldStyle, display: 'inline-flex', alignItems: 'center', fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {active ? '按下新的快捷键' : value}
      </span>
      <Button onClick={onRecord}>{active ? '录制中' : '录制'}</Button>
      <Button onClick={onReset}>重置</Button>
      <span className="screenshot-pin-shortcut-row-status" style={{ color: statusColor }}>
        {statusText}
      </span>
    </div>
  )
}

function EmptyEditor({ onShot, onPin, disabled }: { onShot: () => void; onPin: () => void; disabled: boolean }) {
  return (
    <Panel label="标注编辑器" flex={false}>
      <div className="screenshot-pin-empty-editor">
        <div style={{ width: 54, height: 54, borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--surface3)', display: 'grid', placeItems: 'center', color: 'var(--text)', fontSize: 22, fontWeight: 700 }}>截</div>
        <div style={{ fontSize: 13.5 }}>当前没有待标注截图</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button primary disabled={disabled} onClick={onShot}>截图</Button>
          <Button disabled={disabled} onClick={onPin}>截图并贴图</Button>
        </div>
      </div>
    </Panel>
  )
}

function PinsPanel({
  pins,
  onPin,
  onFocus,
  onToggleVisible,
  onAnnotate,
  onCopy,
  onSave,
  onClose,
  onCloseAll,
}: {
  pins: ScreenshotPinInfo[]
  onPin: () => void
  onFocus: (id: string) => void
  onToggleVisible: (pin: ScreenshotPinInfo) => void
  onAnnotate: (id: string) => void
  onCopy: (pin: ScreenshotPinInfo) => void
  onSave: (pin: ScreenshotPinInfo) => void
  onClose: (id: string) => void
  onCloseAll: () => void
}) {
  return (
    <Panel label="当前贴图" right={pins.length > 1 ? <Button onClick={onCloseAll}>关闭全部</Button> : null} flex={false}>
      <div style={{ padding: 14 }}>
        {!pins.length ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, color: 'var(--text2)', fontSize: 13 }}>
            <span>当前没有贴图</span>
            <Button onClick={onPin}>截图并贴图</Button>
          </div>
        ) : (
          <div className="screenshot-pin-pin-list">
            {pins.map((pin) => (
              <div key={pin.id} className="screenshot-pin-pin-card">
                <img className="screenshot-pin-thumb-pin" src={pin.imageDataUrl} alt="" />
                <div className="screenshot-pin-card-body">
                  <div className="screenshot-pin-card-meta">
                    <span className="screenshot-pin-card-title">{dimensionsText(pin)}</span>
                    <span className="screenshot-pin-card-time">{fmtTime(pin.createdAt)}</span>
                  </div>
                  <div className="screenshot-pin-card-actions">
                    <Button onClick={() => onFocus(pin.id)}>聚焦</Button>
                    <Button onClick={() => onToggleVisible(pin)}>{pin.visible ? '隐藏' : '显示'}</Button>
                    <Button onClick={() => onAnnotate(pin.id)}>标注</Button>
                    <Button onClick={() => onCopy(pin)}>复制</Button>
                    <Button onClick={() => onSave(pin)}>保存</Button>
                    <Button onClick={() => onClose(pin.id)}>关闭</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

function pointerPos(e: PointerEvent<HTMLCanvasElement>): Point {
  const canvas = e.currentTarget
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / rect.width) * canvas.width,
    y: ((e.clientY - rect.top) / rect.height) * canvas.height,
  }
}

function normRect(a: Point, b: Point) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function cloneAnnotation(a: Annotation): Annotation {
  if (a.kind === 'brush') return { ...a, points: a.points.map((p) => ({ ...p })) }
  if (a.kind === 'mosaic') return { ...a, points: a.points.map((p) => ({ ...p })) }
  return { ...a }
}

function cloneAnnotations(items: Annotation[]) {
  return items.map(cloneAnnotation)
}

function expandRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 }
}

function pointInRect(p: Point, r: Rect) {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

function rectIntersects(a: Rect, b: Rect) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
}

function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b }
  const x1 = Math.min(a.x, b.x)
  const y1 = Math.min(a.y, b.y)
  const x2 = Math.max(a.x + a.width, b.x + b.width)
  const y2 = Math.max(a.y + a.height, b.y + b.height)
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function pointsBounds(points: Point[], pad: number): Rect {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = points[0].x
  let maxX = points[0].x
  let minY = points[0].y
  let maxY = points[0].y
  for (const p of points.slice(1)) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 }
}

function textWidth(a: Extract<Annotation, { kind: 'text' }>) {
  let width = 0
  for (const ch of a.text) width += /[\u4e00-\u9fff]/.test(ch) ? a.fontSize : a.fontSize * 0.58
  return Math.max(24, width)
}

function annotationBounds(a: Annotation): Rect {
  if (a.kind === 'arrow') {
    const pad = Math.max(8, a.width * 3)
    return pointsBounds([{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }], pad)
  }
  if (a.kind === 'rect' || a.kind === 'circle') return expandRect({ x: a.x, y: a.y, width: a.width, height: a.height }, Math.max(4, a.lineWidth / 2))
  if (a.kind === 'brush') return pointsBounds(a.points, Math.max(4, a.width / 2))
  if (a.kind === 'text') return { x: a.x, y: a.y, width: textWidth(a), height: Math.max(18, a.fontSize * 1.25) }
  return pointsBounds(a.points, Math.max(6, a.size / 2))
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (!dx && !dy) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1)
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

function hitPolyline(points: Point[], p: Point, tolerance: number) {
  if (!points.length) return false
  if (points.length === 1) return Math.hypot(points[0].x - p.x, points[0].y - p.y) <= tolerance
  for (let i = 1; i < points.length; i++) {
    if (distanceToSegment(p, points[i - 1], points[i]) <= tolerance) return true
  }
  return false
}

function pointInEllipse(p: Point, r: Rect, pad: number) {
  const rx = Math.max(1, r.width / 2 + pad)
  const ry = Math.max(1, r.height / 2 + pad)
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const nx = (p.x - cx) / rx
  const ny = (p.y - cy) / ry
  return nx * nx + ny * ny <= 1
}

function hitAnnotation(a: Annotation, p: Point, zoom: number) {
  const uiPad = 6 / Math.max(zoom, 0.01)
  if (a.kind === 'arrow') {
    return distanceToSegment(p, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }) <= Math.max(8 / zoom, a.width / 2 + 4)
  }
  if (a.kind === 'rect') return pointInRect(p, expandRect({ x: a.x, y: a.y, width: a.width, height: a.height }, uiPad + a.lineWidth / 2))
  if (a.kind === 'circle') return pointInEllipse(p, { x: a.x, y: a.y, width: a.width, height: a.height }, uiPad + a.lineWidth / 2)
  if (a.kind === 'brush') return hitPolyline(a.points, p, a.width / 2 + uiPad)
  if (a.kind === 'text') return pointInRect(p, expandRect(annotationBounds(a), uiPad))
  return hitPolyline(a.points, p, a.size / 2 + uiPad)
}

function topHitAnnotation(annotations: Annotation[], p: Point, zoom: number) {
  for (let i = annotations.length - 1; i >= 0; i--) {
    if (hitAnnotation(annotations[i], p, zoom)) return annotations[i]
  }
  return null
}

function applySelectionMode(current: string[], ids: string[], mode: SelectionMode) {
  if (mode === 'replace') return ids
  const next = new Set(current)
  for (const id of ids) {
    if (mode === 'toggle') {
      if (next.has(id)) next.delete(id)
      else next.add(id)
    } else {
      next.add(id)
    }
  }
  return [...next]
}

function selectionModeFromEvent(e: PointerEvent<HTMLCanvasElement>): SelectionMode {
  if (e.ctrlKey || e.metaKey) return 'toggle'
  if (e.shiftKey) return 'add'
  return 'replace'
}

function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.kind === 'arrow') return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }
  if (a.kind === 'rect' || a.kind === 'circle') return { ...a, x: a.x + dx, y: a.y + dy }
  if (a.kind === 'brush') return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
  if (a.kind === 'text') return { ...a, x: a.x + dx, y: a.y + dy }
  return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
}

function selectedBounds(annotations: Annotation[], ids: string[]) {
  const selected = new Set(ids)
  return annotations.reduce<Rect | null>((acc, ann) => (selected.has(ann.id) ? unionRect(acc, annotationBounds(ann)) : acc), null)
}

function clampMoveDelta(bounds: Rect | null, dx: number, dy: number, width: number, height: number) {
  if (!bounds) return { dx: 0, dy: 0 }
  let nextDx = dx
  let nextDy = dy
  if (bounds.width <= width) nextDx = clamp(nextDx, -bounds.x, width - (bounds.x + bounds.width))
  if (bounds.height <= height) nextDy = clamp(nextDy, -bounds.y, height - (bounds.y + bounds.height))
  return { dx: nextDx, dy: nextDy }
}

function moveAnnotations(annotations: Annotation[], ids: string[], dx: number, dy: number, width: number, height: number) {
  const selected = new Set(ids)
  const delta = clampMoveDelta(selectedBounds(annotations, ids), dx, dy, width, height)
  return annotations.map((ann) => (selected.has(ann.id) ? moveAnnotation(ann, delta.dx, delta.dy) : cloneAnnotation(ann)))
}

function isValidAnnotation(ann: Annotation | null) {
  if (!ann) return false
  if (ann.kind === 'brush' && ann.points.length < 2) return false
  if (ann.kind === 'mosaic' && ann.points.length < 2) return false
  if ((ann.kind === 'rect' || ann.kind === 'circle') && (ann.width < 4 || ann.height < 4)) return false
  if (ann.kind === 'arrow' && Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) < 4) return false
  return true
}

function shapeTextPosition(shape: Extract<Annotation, { kind: 'rect' | 'circle' }>, width: number, height: number, fontSize: number) {
  const textHeight = Math.max(18, fontSize * 1.25)
  return {
    x: clamp(shape.x + 10, 0, Math.max(0, width - 24)),
    y: clamp(shape.y + 10, 0, Math.max(0, height - textHeight)),
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Extract<Annotation, { kind: 'arrow' }>) {
  const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1)
  const head = Math.max(12, a.width * 5)
  ctx.strokeStyle = a.color
  ctx.fillStyle = a.color
  ctx.lineWidth = a.width
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(a.x1, a.y1)
  ctx.lineTo(a.x2, a.y2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(a.x2, a.y2)
  ctx.lineTo(a.x2 - head * Math.cos(angle - Math.PI / 6), a.y2 - head * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(a.x2 - head * Math.cos(angle + Math.PI / 6), a.y2 - head * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

function drawBrush(ctx: CanvasRenderingContext2D, a: Extract<Annotation, { kind: 'brush' }>) {
  if (a.points.length < 2) return
  ctx.strokeStyle = a.color
  ctx.lineWidth = a.width
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(a.points[0].x, a.points[0].y)
  for (const p of a.points.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.stroke()
}

function drawMosaicPatch(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, blockSize: number) {
  const radius = Math.max(4, size / 2)
  const x = Math.max(0, Math.floor(cx - radius))
  const y = Math.max(0, Math.floor(cy - radius))
  const w = Math.min(ctx.canvas.width - x, Math.ceil(radius * 2))
  const h = Math.min(ctx.canvas.height - y, Math.ceil(radius * 2))
  if (w <= 0 || h <= 0) return
  const block = Math.max(4, Math.round(blockSize))
  const data = ctx.getImageData(x, y, w, h)
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.clip()
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      let r = 0
      let g = 0
      let b = 0
      let count = 0
      for (let py = by; py < Math.min(by + block, h); py++) {
        for (let px = bx; px < Math.min(bx + block, w); px++) {
          const i = (py * w + px) * 4
          r += data.data[i]
          g += data.data[i + 1]
          b += data.data[i + 2]
          count++
        }
      }
      if (!count) continue
      ctx.fillStyle = `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`
      ctx.fillRect(x + bx, y + by, Math.min(block, w - bx), Math.min(block, h - by))
    }
  }
  ctx.restore()
}

function drawMosaic(ctx: CanvasRenderingContext2D, a: Extract<Annotation, { kind: 'mosaic' }>) {
  if (a.points.length < 2) return
  const step = Math.max(4, a.size / 3)
  for (let i = 1; i < a.points.length; i++) {
    const prev = a.points[i - 1]
    const next = a.points[i]
    const dist = Math.max(1, Math.hypot(next.x - prev.x, next.y - prev.y))
    const count = Math.max(1, Math.ceil(dist / step))
    for (let j = 0; j <= count; j++) {
      const t = j / count
      drawMosaicPatch(ctx, prev.x + (next.x - prev.x) * t, prev.y + (next.y - prev.y) * t, a.size, a.block)
    }
  }
}

function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation) {
  if (a.kind === 'arrow') drawArrow(ctx, a)
  else if (a.kind === 'brush') drawBrush(ctx, a)
  else if (a.kind === 'rect') {
    ctx.strokeStyle = a.color
    ctx.lineWidth = a.lineWidth
    ctx.strokeRect(a.x, a.y, a.width, a.height)
  } else if (a.kind === 'circle') {
    ctx.strokeStyle = a.color
    ctx.lineWidth = a.lineWidth
    ctx.beginPath()
    ctx.ellipse(a.x + a.width / 2, a.y + a.height / 2, Math.max(0.5, a.width / 2), Math.max(0.5, a.height / 2), 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (a.kind === 'text') {
    ctx.fillStyle = a.color
    ctx.font = `${a.fontSize}px system-ui,-apple-system,Segoe UI,sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(a.text, a.x, a.y)
  } else {
    drawMosaic(ctx, a)
  }
}

function drawSelectionLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, zoom: number) {
  const padX = 8 / zoom
  ctx.save()
  ctx.font = `${12 / zoom}px system-ui,-apple-system,Segoe UI,sans-serif`
  const metrics = ctx.measureText(text)
  const w = metrics.width + padX * 2
  const h = 24 / zoom
  ctx.fillStyle = 'rgba(5, 12, 18, .82)'
  ctx.strokeStyle = SELECT_COLOR
  ctx.lineWidth = 1 / zoom
  const lx = clamp(x, 0, Math.max(0, ctx.canvas.width - w))
  const ly = clamp(y, 0, Math.max(0, ctx.canvas.height - h))
  ctx.fillRect(lx, ly, w, h)
  ctx.strokeRect(lx, ly, w, h)
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, lx + padX, ly + h / 2)
  ctx.restore()
}

function drawEditorUi(ctx: CanvasRenderingContext2D, annotations: Annotation[], selectedIds: string[], interaction: EditorInteraction | null, zoom: number) {
  const selected = new Set(selectedIds)
  const line = 2 / zoom
  ctx.save()
  ctx.strokeStyle = SELECT_COLOR
  ctx.fillStyle = 'rgba(53, 213, 199, .12)'
  ctx.lineWidth = line
  ctx.setLineDash([6 / zoom, 4 / zoom])
  let group: Rect | null = null
  for (const ann of annotations) {
    if (!selected.has(ann.id)) continue
    const r = expandRect(annotationBounds(ann), 4 / zoom)
    group = unionRect(group, r)
    ctx.strokeRect(r.x, r.y, r.width, r.height)
  }
  if (group && selectedIds.length > 1) {
    ctx.setLineDash([])
    ctx.lineWidth = 2.5 / zoom
    ctx.strokeRect(group.x, group.y, group.width, group.height)
    drawSelectionLabel(ctx, `已选 ${selectedIds.length} 个`, group.x + group.width + 6 / zoom, group.y, zoom)
  } else if (group) {
    drawSelectionLabel(ctx, '已选 1 个', group.x + group.width + 6 / zoom, group.y, zoom)
  }
  if (interaction?.kind === 'marquee') {
    const r = normRect(interaction.start, interaction.current)
    ctx.setLineDash([5 / zoom, 4 / zoom])
    ctx.lineWidth = 1.5 / zoom
    ctx.fillRect(r.x, r.y, r.width, r.height)
    ctx.strokeRect(r.x, r.y, r.width, r.height)
    drawSelectionLabel(ctx, '框选中', r.x + r.width + 6 / zoom, r.y + r.height + 6 / zoom, zoom)
  }
  ctx.restore()
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  annotations: Annotation[],
  draft: Annotation | null,
  ui?: { selectedIds?: string[]; interaction?: EditorInteraction | null; zoom?: number }
) {
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  for (const ann of annotations) drawAnnotation(ctx, ann)
  if (draft) drawAnnotation(ctx, draft)
  if (ui) drawEditorUi(ctx, annotations, ui.selectedIds || [], ui.interaction || null, ui.zoom || 1)
}

function RangeControl({
  label,
  value,
  min,
  max,
  onChange,
  unit = 'px',
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  unit?: string
}) {
  return (
    <label style={{ display: 'grid', gap: 4, minWidth: 132, color: 'var(--text2)', fontSize: 12 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{label}</span>
        <span style={{ color: 'var(--text)', fontFamily: MONO }}>{value}{unit}</span>
      </span>
      <input
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        type="range"
        aria-label={label}
        style={{ width: '100%' }}
      />
    </label>
  )
}

function AnnotationEditor({ capture, onCancel, onDone }: { capture: ScreenshotCapture; onCancel: () => void; onDone: () => void }) {
  const { flash } = useToolbox()
  const api = screenshotHost
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const textInputRef = useRef<HTMLInputElement | null>(null)
  const textDraftSeq = useRef(0)
  const annotationSeq = useRef(0)
  const committedTextDraft = useRef<number | null>(null)
  const interactionRef = useRef<EditorInteraction | null>(null)
  const spacePanRef = useRef(false)
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<AnnotationTool>('arrow')
  const [color, setColor] = useState('#ff3b30')
  const [lineWidth, setLineWidth] = useState(4)
  const [mosaicSize, setMosaicSize] = useState(32)
  const [fontSize, setFontSize] = useState(28)
  const [shapeText, setShapeText] = useState(false)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [undoStack, setUndoStack] = useState<Annotation[][]>([])
  const [redoStack, setRedoStack] = useState<Annotation[][]>([])
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [interaction, setInteraction] = useState<EditorInteraction | null>(null)
  const [zoom, setZoom] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>('fit')
  const [spacePan, setSpacePan] = useState(false)

  useEffect(() => {
    let alive = true
    setAnnotations([])
    setUndoStack([])
    setRedoStack([])
    setDraft(null)
    setTextDraft(null)
    setSelectedIds([])
    setInteraction(null)
    setBaseImage(null)
    setZoom(1)
    setViewMode('fit')
    setShapeText(false)
    loadImage(capture.imageDataUrl).then((img) => {
      if (alive) setBaseImage(img)
    })
    return () => {
      alive = false
    }
  }, [capture])

  useEffect(() => {
    interactionRef.current = interaction
  }, [interaction])

  useEffect(() => {
    spacePanRef.current = spacePan
  }, [spacePan])

  useEffect(() => {
    if (!textDraft) return
    let disposed = false
    const focusInput = () => {
      if (disposed) return
      textInputRef.current?.focus({ preventScroll: true })
      textInputRef.current?.select()
    }
    focusInput()
    const raf = window.requestAnimationFrame(focusInput)
    const timer = window.setTimeout(focusInput, 80)
    return () => {
      disposed = true
      window.cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [textDraft?.id])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !baseImage) return
    canvas.width = capture.width
    canvas.height = capture.height
    const ctx = canvas.getContext('2d')
    if (ctx) drawScene(ctx, baseImage, capture.width, capture.height, annotations, draft, { selectedIds, interaction, zoom })
  }, [annotations, baseImage, capture.height, capture.width, draft, interaction, selectedIds, zoom])

  const nextAnnotationId = useCallback(() => `ann_${Date.now()}_${++annotationSeq.current}`, [])

  const applyAnnotationChange = useCallback((nextFactory: (prev: Annotation[]) => Annotation[], options?: { clearSelection?: boolean }) => {
    setAnnotations((prev) => {
      const before = cloneAnnotations(prev)
      const next = cloneAnnotations(nextFactory(before))
      if (JSON.stringify(before) === JSON.stringify(next)) return prev
      setUndoStack((stack) => [before, ...stack])
      setRedoStack([])
      if (options?.clearSelection) setSelectedIds([])
      else {
        const nextIds = new Set(next.map((ann) => ann.id))
        setSelectedIds((ids) => ids.filter((id) => nextIds.has(id)))
      }
      return next
    })
  }, [])

  const commit = useCallback((ann: Annotation | null) => {
    if (!ann) return
    if (!isValidAnnotation(ann)) return
    applyAnnotationChange((prev) => [...prev, cloneAnnotation(ann)], { clearSelection: true })
  }, [applyAnnotationChange])

  const commitShapeWithTextDraft = useCallback(
    (ann: Annotation | null) => {
      if (!ann || (ann.kind !== 'rect' && ann.kind !== 'circle') || !isValidAnnotation(ann)) return false
      const shape = cloneAnnotation(ann) as Extract<Annotation, { kind: 'rect' | 'circle' }>
      applyAnnotationChange((prev) => [...prev, shape], { clearSelection: true })
      const pos = shapeTextPosition(shape, capture.width, capture.height, fontSize)
      const id = ++textDraftSeq.current
      committedTextDraft.current = null
      setTextDraft({ id, x: pos.x, y: pos.y, text: '', createdAt: Date.now(), appendToCurrentUndo: true })
      return true
    },
    [applyAnnotationChange, capture.height, capture.width, fontSize]
  )

  const rememberImage = useCallback(
    (dataUrl: string) => {
      void api?.rememberScreenshot(dataUrl, { displayId: capture.displayId })
    },
    [api, capture.displayId]
  )

  const commitTextDraft = useCallback(
    (item: TextDraft | null, value: string) => {
      if (!item || committedTextDraft.current === item.id) return
      committedTextDraft.current = item.id
      const text = value.trim()
      if (text) {
        const ann: Annotation = { id: nextAnnotationId(), kind: 'text', x: item.x, y: item.y, text, color, fontSize }
        if (item.appendToCurrentUndo) {
          setAnnotations((prev) => [...prev, cloneAnnotation(ann)])
          setSelectedIds([])
        } else {
          commit(ann)
        }
      }
      setTextDraft((current) => (current?.id === item.id ? null : current))
    },
    [color, commit, fontSize, nextAnnotationId]
  )

  const settleTextDraftForAction = useCallback(() => {
    if (!textDraft || committedTextDraft.current === textDraft.id) return annotations
    committedTextDraft.current = textDraft.id
    setTextDraft(null)
    const text = textDraft.text.trim()
    if (!text) return annotations
    const ann: Annotation = { id: nextAnnotationId(), kind: 'text', x: textDraft.x, y: textDraft.y, text, color, fontSize }
    const next = [...cloneAnnotations(annotations), ann]
    if (textDraft.appendToCurrentUndo) {
      setAnnotations(next)
      setSelectedIds([])
    } else {
      setUndoStack((stack) => [cloneAnnotations(annotations), ...stack])
      setRedoStack([])
      setAnnotations(next)
      setSelectedIds([])
    }
    return next
  }, [annotations, color, fontSize, nextAnnotationId, textDraft])

  const exportImage = useCallback(() => {
    if (!baseImage) throw new Error('图片加载中')
    const exportAnnotations = settleTextDraftForAction()
    const canvas = document.createElement('canvas')
    canvas.width = capture.width
    canvas.height = capture.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('导出失败')
    drawScene(ctx, baseImage, capture.width, capture.height, exportAnnotations, null)
    return canvas.toDataURL('image/png')
  }, [baseImage, capture.height, capture.width, settleTextDraftForAction])

  const startPan = useCallback((e: PointerEvent<HTMLCanvasElement>) => {
    const viewport = viewportRef.current
    if (!viewport) return
    e.preventDefault()
    setViewMode('manual')
    setInteraction({ kind: 'pan', startClient: { x: e.clientX, y: e.clientY }, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop })
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 非标准指针序列不影响平移状态。 */
    }
  }, [])

  const pointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!baseImage) return
    viewportRef.current?.focus({ preventScroll: true })
    if (tool !== 'text' && textDraft) commitTextDraft(textDraft, textDraft.text)
    if (tool === 'pan' || spacePanRef.current || e.button === 1) {
      startPan(e)
      return
    }
    const p = pointerPos(e)
    if (tool === 'select') {
      e.preventDefault()
      const mode = selectionModeFromEvent(e)
      const hit = topHitAnnotation(annotations, p, zoom)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* 合成事件或异常指针序列不应中断选择初始化。 */
      }
      if (hit) {
        let next = selectedIds
        if (mode === 'replace') next = selectedIds.includes(hit.id) ? selectedIds : [hit.id]
        else next = applySelectionMode(selectedIds, [hit.id], mode)
        setSelectedIds(next)
        if (next.includes(hit.id)) setInteraction({ kind: 'move', ids: next, start: p, current: p, origin: cloneAnnotations(annotations), moved: false })
        else setInteraction(null)
      } else {
        if (mode === 'replace') setSelectedIds([])
        setInteraction({ kind: 'marquee', start: p, current: p, mode })
      }
      return
    }
    if (tool === 'text') {
      e.preventDefault()
      e.stopPropagation()
      if (textDraft) commitTextDraft(textDraft, textDraft.text)
      const id = ++textDraftSeq.current
      committedTextDraft.current = null
      setTextDraft({ id, x: p.x, y: p.y, text: '', createdAt: Date.now(), protectInitialBlur: true })
      return
    }
    if (textDraft) commitTextDraft(textDraft, textDraft.text)
    setSelectedIds([])
    setInteraction({ kind: 'draw' })
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件或异常指针序列不应中断绘制初始化。 */
    }
    if (tool === 'brush') setDraft({ id: nextAnnotationId(), kind: 'brush', points: [p], color, width: lineWidth })
    else if (tool === 'arrow') setDraft({ id: nextAnnotationId(), kind: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, width: lineWidth })
    else if (tool === 'rect') setDraft({ id: nextAnnotationId(), kind: 'rect', x: p.x, y: p.y, width: 0, height: 0, color, lineWidth })
    else if (tool === 'circle') setDraft({ id: nextAnnotationId(), kind: 'circle', x: p.x, y: p.y, width: 0, height: 0, color, lineWidth })
    else setDraft({ id: nextAnnotationId(), kind: 'mosaic', points: [p], size: mosaicSize, block: Math.max(6, Math.round(mosaicSize / 3)) })
  }

  const pointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const current = interactionRef.current
    if (!current) return
    if (current.kind === 'pan') {
      const viewport = viewportRef.current
      if (!viewport) return
      viewport.scrollLeft = current.scrollLeft - (e.clientX - current.startClient.x)
      viewport.scrollTop = current.scrollTop - (e.clientY - current.startClient.y)
      return
    }
    const p = pointerPos(e)
    if (current.kind === 'marquee') {
      setInteraction({ ...current, current: p })
      return
    }
    if (current.kind === 'move') {
      const dx = p.x - current.start.x
      const dy = p.y - current.start.y
      const moved = current.moved || Math.hypot(dx, dy) > 1
      setAnnotations(moveAnnotations(current.origin, current.ids, dx, dy, capture.width, capture.height))
      setInteraction({ ...current, current: p, moved })
      return
    }
    if (!draft) return
    if (draft.kind === 'brush') setDraft({ ...draft, points: [...draft.points, p] })
    else if (draft.kind === 'arrow') setDraft({ ...draft, x2: p.x, y2: p.y })
    else if (draft.kind === 'rect' || draft.kind === 'circle') {
      const r = normRect({ x: draft.x, y: draft.y }, p)
      setDraft({ ...draft, ...r })
    } else if (draft.kind === 'mosaic') {
      const last = draft.points[draft.points.length - 1]
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1) setDraft({ ...draft, points: [...draft.points, p] })
    }
  }

  const pointerUp = () => {
    const current = interactionRef.current
    if (!current) return
    if (current.kind === 'draw') {
      if (!shapeText || !draft || (draft.kind !== 'rect' && draft.kind !== 'circle')) commit(draft)
      else commitShapeWithTextDraft(draft)
      setDraft(null)
    } else if (current.kind === 'marquee') {
      const r = normRect(current.start, current.current)
      if (r.width >= 3 || r.height >= 3) {
        const ids = annotations.filter((ann) => rectIntersects(annotationBounds(ann), r)).map((ann) => ann.id)
        setSelectedIds((prev) => applySelectionMode(prev, ids, current.mode))
      }
    } else if (current.kind === 'move') {
      if (current.moved) {
        setUndoStack((stack) => [cloneAnnotations(current.origin), ...stack])
        setRedoStack([])
      } else {
        setAnnotations(cloneAnnotations(current.origin))
      }
    }
    setInteraction(null)
  }

  const undo = () => {
    setUndoStack((prev) => {
      if (!prev.length) return prev
      const [snapshot, ...rest] = prev
      setAnnotations((current) => {
        setRedoStack((redo) => [cloneAnnotations(current), ...redo])
        return cloneAnnotations(snapshot)
      })
      setSelectedIds([])
      setDraft(null)
      setInteraction(null)
      return rest
    })
  }

  const redo = () => {
    setRedoStack((prev) => {
      if (!prev.length) return prev
      const [snapshot, ...rest] = prev
      setAnnotations((current) => {
        setUndoStack((undoItems) => [cloneAnnotations(current), ...undoItems])
        return cloneAnnotations(snapshot)
      })
      setSelectedIds([])
      setDraft(null)
      setInteraction(null)
      return rest
    })
  }

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return
    const selected = new Set(selectedIds)
    applyAnnotationChange((prev) => prev.filter((ann) => !selected.has(ann.id)), { clearSelection: true })
  }, [applyAnnotationChange, selectedIds])

  const clearAnnotations = useCallback(() => {
    if (!annotations.length) return
    applyAnnotationChange(() => [], { clearSelection: true })
  }, [annotations.length, applyAnnotationChange])

  const zoomAround = useCallback((nextZoom: number, center?: Point) => {
    const viewport = viewportRef.current
    const next = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    setViewMode('manual')
    if (!viewport) {
      setZoom(next)
      return
    }
    const rect = viewport.getBoundingClientRect()
    const cx = center ? center.x - rect.left : viewport.clientWidth / 2
    const cy = center ? center.y - rect.top : viewport.clientHeight / 2
    const imageX = (viewport.scrollLeft + cx) / zoom
    const imageY = (viewport.scrollTop + cy) / zoom
    setZoom(next)
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = imageX * next - cx
      viewport.scrollTop = imageY * next - cy
    })
  }, [zoom])

  const fitZoom = useCallback((keepMode?: boolean) => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (!keepMode) setViewMode('fit')
    const next = clamp(Math.min(viewport.clientWidth / capture.width, viewport.clientHeight / capture.height), MIN_ZOOM, MAX_ZOOM)
    setZoom(next)
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, (capture.width * next - viewport.clientWidth) / 2)
      viewport.scrollTop = Math.max(0, (capture.height * next - viewport.clientHeight) / 2)
    })
  }, [capture.height, capture.width])

  useEffect(() => {
    if (!baseImage || viewMode !== 'fit') return
    const viewport = viewportRef.current
    if (!viewport) return
    let raf = 0
    const run = () => {
      if (raf) window.cancelAnimationFrame(raf)
      raf = window.requestAnimationFrame(() => fitZoom(true))
    }
    run()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(run)
      observer.observe(viewport)
      return () => {
        if (raf) window.cancelAnimationFrame(raf)
        observer.disconnect()
      }
    }
    window.addEventListener('resize', run)
    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', run)
    }
  }, [baseImage, fitZoom, viewMode])

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    zoomAround(zoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), { x: e.clientX, y: e.clientY })
  }

  const isInputTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null
    if (!el) return false
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
  }

  const onEditorKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isInputTarget(e.target)) return
    if (e.key === ' ') {
      if (!e.repeat) setSpacePan(true)
      e.preventDefault()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelectedIds(annotations.map((ann) => ann.id))
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (undoStack.length) undo()
      return
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault()
      if (redoStack.length) redo()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedIds.length) {
        e.preventDefault()
        deleteSelected()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      const current = interactionRef.current
      if (textDraft) setTextDraft(null)
      else if (current?.kind === 'move') {
        setAnnotations(cloneAnnotations(current.origin))
        setInteraction(null)
      } else if (current) setInteraction(null)
      else if (selectedIds.length) setSelectedIds([])
    }
  }

  const onEditorKeyUp = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ') setSpacePan(false)
  }

  const copy = async () => {
    if (!api) return
    const dataUrl = exportImage()
    const result = await api.copyImage(dataUrl)
    if (result.ok) rememberImage(dataUrl)
    flash(result.ok ? '图片已复制' : result.error || '复制失败')
  }

  const save = async () => {
    if (!api) return
    const dataUrl = exportImage()
    const result = await api.saveImage(dataUrl, 'ttool-screenshot.png')
    if (result.ok) rememberImage(dataUrl)
    if (!result.canceled) flash(result.ok ? '图片已保存' : result.error || '保存失败')
  }

  const pin = async () => {
    if (!api) return
    const dataUrl = exportImage()
    const result = capture.pinId ? await api.updatePin(capture.pinId, dataUrl) : await api.createPin(dataUrl, { displayId: capture.displayId })
    if (result.ok) rememberImage(dataUrl)
    flash(result.ok ? (capture.pinId ? '贴图已更新' : '已创建贴图') : result.error || '贴图失败')
    if (result.ok) onDone()
  }

  const textInputStyle = useMemo<CSSProperties>(() => {
    if (!textDraft) return {}
    return {
      position: 'absolute',
      left: `${textDraft.x * zoom}px`,
      top: `${textDraft.y * zoom}px`,
      minWidth: Math.max(120, 120 * zoom),
      height: Math.max(34, (fontSize + 10) * zoom),
      border: '1px solid var(--accent)',
      borderRadius: 8,
      background: 'var(--surface)',
      color,
      padding: '0 8px',
      fontSize: Math.max(12, fontSize * zoom),
      zIndex: 2,
      outline: 'none',
    }
  }, [color, fontSize, textDraft, zoom])

  const statusText = interaction?.kind === 'marquee'
    ? '框选中'
    : interaction?.kind === 'move'
      ? '移动中'
      : interaction?.kind === 'pan'
        ? '拖拽视图'
        : selectedIds.length
          ? `已选 ${selectedIds.length} 个`
          : viewMode === 'fit'
            ? `适配 ${Math.round(zoom * 100)}%`
            : `${Math.round(zoom * 100)}%`

  const canvasCursor = interaction?.kind === 'pan'
    ? 'grabbing'
    : tool === 'pan' || spacePan
      ? 'grab'
      : tool === 'text'
        ? 'text'
        : tool === 'select'
          ? 'default'
          : 'crosshair'

  return (
    <Panel
      label={capture.source === 'pin-annotate' ? '标注贴图' : '标注编辑器'}
      right={<span style={{ color: 'var(--text3)', fontSize: 12 }}>{capture.width} × {capture.height}px</span>}
      flex={false}
    >
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Seg
            value={tool}
            onChange={(v) => {
              if (textDraft) commitTextDraft(textDraft, textDraft.text)
              setInteraction(null)
              setDraft(null)
              setTool(v as AnnotationTool)
            }}
            options={[
              { key: 'select', label: '选择' },
              { key: 'arrow', label: '箭头' },
              { key: 'rect', label: '矩形' },
              { key: 'circle', label: '圆形' },
              { key: 'brush', label: '画笔' },
              { key: 'text', label: '文本' },
              { key: 'mosaic', label: '马赛克' },
              { key: 'pan', label: '拖拽' },
            ]}
          />
          {tool !== 'mosaic' && tool !== 'select' && tool !== 'pan' && (
            <label style={{ display: 'grid', gap: 4, color: 'var(--text2)', fontSize: 12 }}>
              <span>颜色</span>
              <input value={color} onChange={(e) => setColor(e.target.value)} type="color" style={{ width: 34, height: 34, border: '1px solid var(--hair)', borderRadius: 8, background: 'var(--pill)' }} />
            </label>
          )}
          {tool === 'text' ? (
            <RangeControl label="字号" min={14} max={64} value={fontSize} onChange={setFontSize} />
          ) : tool === 'mosaic' ? (
            <RangeControl label="马赛克笔刷" min={12} max={72} value={mosaicSize} onChange={setMosaicSize} />
          ) : tool !== 'select' && tool !== 'pan' ? (
            <RangeControl label="线宽" min={2} max={16} value={lineWidth} onChange={setLineWidth} />
          ) : null}
          {(tool === 'rect' || tool === 'circle') && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 34, color: 'var(--text2)', fontSize: 12 }}>
              <input type="checkbox" checked={shapeText} onChange={(e) => setShapeText(e.target.checked)} />
              <span>携带文本</span>
            </label>
          )}
          <Button disabled={!selectedIds.length} onClick={deleteSelected}>删除</Button>
          <Button disabled={!undoStack.length} onClick={undo}>撤销</Button>
          <Button disabled={!redoStack.length} onClick={redo}>重做</Button>
          <Button disabled={!annotations.length} onClick={clearAnnotations}>清空</Button>
          <Chip>{statusText}</Chip>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginLeft: 'auto' }}>
            <Button disabled={zoom <= MIN_ZOOM} onClick={() => zoomAround(zoom / ZOOM_STEP)}>−</Button>
            <Chip>{Math.round(zoom * 100)}%</Chip>
            <Button disabled={zoom >= MAX_ZOOM} onClick={() => zoomAround(zoom * ZOOM_STEP)}>＋</Button>
            <Button onClick={fitZoom}>适配</Button>
            <Button onClick={() => zoomAround(1)}>100%</Button>
          </div>
        </div>

        <div
          ref={viewportRef}
          tabIndex={0}
          onKeyDown={onEditorKeyDown}
          onKeyUp={onEditorKeyUp}
          onWheel={onWheel}
          style={{
            position: 'relative',
            width: '100%',
            height: 'min(62vh, 680px)',
            minHeight: 420,
            overflow: 'auto',
            border: '1px solid var(--hair)',
            borderRadius: 12,
            background: 'var(--surface3)',
            outline: 'none',
          }}
        >
          <div style={{ position: 'relative', width: capture.width * zoom, height: capture.height * zoom, minWidth: '100%', minHeight: '100%' }}>
            <canvas
              ref={canvasRef}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              style={{
                display: 'block',
                width: capture.width * zoom,
                height: capture.height * zoom,
                cursor: canvasCursor,
              }}
            />
            {textDraft && (
              <input
                ref={textInputRef}
                autoFocus
                style={textInputStyle}
                value={textDraft.text}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => setTextDraft({ ...textDraft, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitTextDraft(textDraft, textDraft.text)
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setTextDraft(null)
                  }
                }}
                onBlur={(e) => {
                  if (textDraft?.protectInitialBlur && !e.currentTarget.value.trim() && Date.now() - textDraft.createdAt < 350) {
                    window.setTimeout(() => textInputRef.current?.focus({ preventScroll: true }), 0)
                    return
                  }
                  commitTextDraft(textDraft, e.currentTarget.value)
                }}
              />
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button onClick={copy}>复制</Button>
          <Button onClick={save}>保存</Button>
          <Button primary onClick={pin}>{capture.pinId ? '更新贴图' : '贴图'}</Button>
          <Button onClick={onCancel}>取消</Button>
        </div>
      </div>
    </Panel>
  )
}

registerTool({
  id: TOOL_ID,
  name: '截图贴图',
  desc: '截图 · 标注 · 置顶贴图',
  glyph: '截',
  cat: '设计',
  hue: 'teal',
  order: 15,
  component: ScreenshotPinTool,
  keywords: 'screenshot capture pin annotation jietu tietu',
})
