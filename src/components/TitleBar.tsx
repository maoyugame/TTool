import { useTheme } from '../theme/ThemeContext'
import { useToolbox } from '../store/toolbox'
import { platform } from '../platform'

const dotBase = { width: 12, height: 12, borderRadius: '50%' } as const

const iconBtn = {
  width: 32,
  height: 32,
  borderRadius: 9,
  background: 'var(--pill)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text2)',
  cursor: 'pointer',
  transition: 'background .16s',
} as const

export function TitleBar() {
  const { theme, toggle } = useTheme()
  const { openSettings, openExtensions } = useToolbox()
  const themeIcon = theme === 'light' ? '☾' : '☀'
  const desktop = platform.isDesktop

  return (
    <div
      className="tb-drag"
      style={{
        position: 'relative',
        zIndex: 5,
        height: 46,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        background: 'var(--bar)',
        backdropFilter: 'blur(30px) saturate(160%)',
        WebkitBackdropFilter: 'blur(30px) saturate(160%)',
        borderBottom: '1px solid var(--barHair)',
        flexShrink: 0,
      }}
    >
      <div className="tb-nodrag" style={{ display: 'flex', gap: 8 }}>
        <span onClick={() => platform.window.close()} style={{ ...dotBase, background: '#ff5f57', cursor: desktop ? 'pointer' : 'default' }} />
        <span onClick={() => platform.window.minimize()} style={{ ...dotBase, background: '#febc2e', cursor: desktop ? 'pointer' : 'default' }} />
        <span onClick={() => platform.window.toggleMaximize()} style={{ ...dotBase, background: '#28c840', cursor: desktop ? 'pointer' : 'default' }} />
      </div>
      <div style={{ flex: 1 }} />
      <div className="tb-nodrag" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div onClick={toggle} className="hov-surface3" style={{ ...iconBtn, fontSize: 14 }} title="切换深 / 浅色">
          {themeIcon}
        </div>
        <div onClick={openExtensions} className="hov-surface3" style={{ ...iconBtn, fontSize: 14 }} title="扩展 · 工具插件">
          🧩
        </div>
        <div onClick={openSettings} className="hov-surface3" style={{ ...iconBtn, fontSize: 15 }} title="设置">
          ⚙
        </div>
      </div>
    </div>
  )
}
