import { useState } from 'react'
import { useTheme } from '../theme/ThemeContext'
import { useToolbox } from '../store/toolbox'
import { platform } from '../platform'
import { kbd } from '../platform/shortcuts'
import { toolCount } from '../tools/registry'
import { isFileSearchOn, setFileSearchOn } from '../store/fileSearch'
import packageInfo from '../../package.json'

const APP_VERSION = packageInfo.version

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
            <span style={{ fontSize: 13, color: 'var(--text)' }}>v{APP_VERSION}</span>
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
