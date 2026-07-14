import { useEffect, useState } from 'react'
import { useTheme } from '../theme/ThemeContext'
import { useToolbox } from '../store/toolbox'
import { platform } from '../platform'
import { kbd } from '../platform/shortcuts'
import { toolCount } from '../tools/registry'
import { isFileSearchOn, setFileSearchOn } from '../store/fileSearch'
import packageInfo from '../../package.json'
import type { UpdateState } from '../platform/types'

const APP_VERSION = packageInfo.version

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function updateStatusText(state: UpdateState) {
  switch (state.status) {
    case 'disabled': return '开发环境不检查更新，安装版中自动启用'
    case 'unsupported': return '当前平台暂未启用自动更新'
    case 'checking': return '正在检查更新…'
    case 'up-to-date': return '当前已是最新版本'
    case 'available': return `发现新版本 v${state.availableVersion || ''}`
    case 'downloading': return `正在下载 ${state.progress?.percent.toFixed(1) || '0.0'}%`
    case 'downloaded': return `v${state.availableVersion || ''} 已下载，等待重启安装`
    case 'installing': return '正在退出并安装更新…'
    case 'error': return state.error || '检查更新失败'
    default: return '自动更新已就绪'
  }
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{ width: 42, height: 24, borderRadius: 12, background: on ? 'var(--accent)' : 'var(--pill)', position: 'relative', cursor: 'pointer', transition: 'background .18s', flexShrink: 0 }}
    >
      <span style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .18s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
    </span>
  )
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '13px 15px',
  borderRadius: 12,
  background: 'var(--surface2)',
  border: '1px solid var(--hair)',
} as const

const labelMuted = { fontSize: 13, color: 'var(--text2)' } as const

function ShortcutRow({ keys, desc }: { keys: string; desc: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 2px' }}>
      <span style={{ fontSize: 13.5, color: 'var(--text)' }}>{desc}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', fontFamily: 'ui-monospace,monospace', background: 'var(--pill)', padding: '4px 9px', borderRadius: 7, whiteSpace: 'nowrap' }}>{keys}</span>
    </div>
  )
}

export function SettingsPanel() {
  const { settingsOpen, closeSettings, devMode, setDevMode } = useToolbox()
  const { theme, setTheme } = useTheme()
  const [fileSearch, setFileSearch] = useState(isFileSearchOn())
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateActionError, setUpdateActionError] = useState<string | null>(null)

  useEffect(() => {
    const api = platform.updates
    if (!api) return
    let active = true
    void api.getState()
      .then((state) => { if (active) setUpdateState(state) })
      .catch(() => { if (active) setUpdateActionError('无法读取更新状态') })
    const off = api.onState((state) => {
      if (!active) return
      setUpdateState(state)
      if (state.status !== 'error') setUpdateActionError(null)
    })
    return () => {
      active = false
      off()
    }
  }, [])

  const runUpdateAction = async () => {
    const api = platform.updates
    if (!api || !updateState || updateBusy) return
    setUpdateBusy(true)
    setUpdateActionError(null)
    try {
      const result = updateState.status === 'available'
        ? await api.download()
        : updateState.status === 'downloaded'
          ? await api.install()
          : await api.check()
      if (!result.ok && result.error !== 'CANCELED') setUpdateActionError(result.error || '更新操作失败')
    } catch {
      setUpdateActionError('更新服务暂时不可用')
    } finally {
      setUpdateBusy(false)
    }
  }

  if (!settingsOpen) return null

  const seg = (val: 'dark' | 'light', label: string) => {
    const on = theme === val
    return (
      <span
        onClick={() => setTheme(val)}
        style={{ fontSize: 13, fontWeight: 540, color: on ? '#fff' : 'var(--text2)', background: on ? 'var(--accent)' : 'transparent', padding: '7px 16px', borderRadius: 8, cursor: 'pointer', transition: 'all .15s' }}
      >
        {label}
      </span>
    )
  }

  return (
    <div
      onClick={closeSettings}
      style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.32)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', animation: 'fadeIn .18s both' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 460, maxWidth: '90%', maxHeight: '84%', overflowY: 'auto', borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--hair2)', boxShadow: '0 30px 80px rgba(0,0,0,.4)', padding: 24, animation: 'fadeUp .26s both' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)' }}>设置</span>
          <span onClick={closeSettings} className="hov-surface3" style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--pill)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontSize: 16, cursor: 'pointer' }}>×</span>
        </div>

        {/* 外观 */}
        <div style={{ fontSize: 11.5, fontWeight: 680, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10 }}>外观</div>
        <div style={{ ...rowStyle, marginBottom: 22 }}>
          <span style={{ fontSize: 13.5, color: 'var(--text)' }}>主题</span>
          <div style={{ display: 'inline-flex', gap: 4, background: 'var(--pill)', borderRadius: 10, padding: 3 }}>
            {seg('dark', '深色')}
            {seg('light', '浅色')}
          </div>
        </div>

        {/* 搜索（仅桌面：本机文件搜索走系统索引） */}
        {platform.isDesktop && platform.searchFiles && (
          <>
            <div style={{ fontSize: 11.5, fontWeight: 680, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10 }}>搜索</div>
            <div style={{ ...rowStyle, marginBottom: 22 }}>
              <div>
                <div style={{ fontSize: 13.5, color: 'var(--text)' }}>搜索本机文件</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>开启后，搜索框（含 Alt+Space 启动器）会同时搜索本机文件（系统索引）。默认仅搜工具。</div>
              </div>
              <Toggle on={fileSearch} onClick={() => { const v = !fileSearch; setFileSearch(v); setFileSearchOn(v) }} />
            </div>
          </>
        )}

        {/* 宿主更新（不属于插件 SDK，仅 Windows 安装版启用） */}
        {platform.updates && updateState && (
          <>
            <div style={{ fontSize: 11.5, fontWeight: 680, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10 }}>更新</div>
            <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 10, marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--text)' }}>{updateStatusText(updateState)}</div>
                  {updateState.status === 'downloading' && updateState.progress && (
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 3 }}>
                      {formatBytes(updateState.progress.transferred)} / {formatBytes(updateState.progress.total)} · {formatBytes(updateState.progress.bytesPerSecond)}/s
                    </div>
                  )}
                  {updateActionError && <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 3 }}>{updateActionError}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => { void runUpdateAction() }}
                  disabled={updateBusy || !updateState.enabled || ['checking', 'downloading', 'installing'].includes(updateState.status)}
                  style={{ border: '1px solid var(--hair2)', borderRadius: 8, padding: '7px 12px', background: 'var(--accentSoft)', color: 'var(--accent)', cursor: updateBusy || !updateState.enabled ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 650, opacity: updateBusy || !updateState.enabled ? .55 : 1, whiteSpace: 'nowrap' }}
                >
                  {updateState.status === 'available' ? '下载更新' : updateState.status === 'downloaded' ? '重启更新' : '检查更新'}
                </button>
              </div>
              {updateState.progress && updateState.status === 'downloading' && (
                <div style={{ height: 5, borderRadius: 3, background: 'var(--pill)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${updateState.progress.percent}%`, background: 'var(--accent)', transition: 'width .2s' }} />
                </div>
              )}
              {updateState.releaseNotes && ['available', 'downloading', 'downloaded'].includes(updateState.status) && (
                <div style={{ maxHeight: 110, overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: 11.5, lineHeight: 1.55, color: 'var(--text2)', paddingTop: 2 }}>
                  {updateState.releaseNotes}
                </div>
              )}
            </div>
          </>
        )}

        {/* 快捷键 */}
        <div style={{ fontSize: 11.5, fontWeight: 680, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10 }}>快捷键</div>
        <div style={{ padding: '4px 12px', borderRadius: 12, background: 'var(--surface2)', border: '1px solid var(--hair)', marginBottom: 22 }}>
          <ShortcutRow keys={kbd('K')} desc="聚焦搜索 / 回到启动台" />
          <ShortcutRow keys={kbd('W')} desc="关闭当前标签" />
          <ShortcutRow keys="Esc" desc="返回启动台" />
          {platform.isDesktop && <ShortcutRow keys="Alt + Space / Ctrl+Alt+Space" desc="全局唤起快速启动器小窗" />}
        </div>

        {/* 开发者 */}
        <div style={{ fontSize: 11.5, fontWeight: 680, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10 }}>开发者</div>
        <div style={{ ...rowStyle, marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 13.5, color: 'var(--text)' }}>开发者模式</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>允许在「扩展」里从本地文件夹安装插件，用于自测/离线分发</div>
          </div>
          <span
            onClick={() => setDevMode(!devMode)}
            style={{ width: 42, height: 24, borderRadius: 12, background: devMode ? 'var(--accent)' : 'var(--pill)', position: 'relative', cursor: 'pointer', transition: 'background .18s', flexShrink: 0 }}
          >
            <span style={{ position: 'absolute', top: 2, left: devMode ? 20 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .18s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
          </span>
        </div>

        {/* 关于 */}
        <div style={{ fontSize: 11.5, fontWeight: 680, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10 }}>关于</div>
        <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={labelMuted}>名称</span>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>TTool</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={labelMuted}>版本</span>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>v{updateState?.currentVersion || APP_VERSION}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={labelMuted}>工具数量</span>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>{toolCount()} 个</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={labelMuted}>运行环境</span>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>{platform.isDesktop ? '桌面 (Electron)' : '浏览器'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
