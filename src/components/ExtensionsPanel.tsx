import { useState, useEffect, useCallback } from 'react'
import { useToolbox } from '../store/toolbox'
import { platform } from '../platform'
import { syncPlugins } from '../plugins/loader'
import { ToolIcon } from './ToolIcon'
import type { InstalledPlugin } from '../platform/types'
import type { HueName } from '../tools/hue'
import { HUE } from '../tools/hue'

const HUES = Object.keys(HUE) as HueName[]
const sectionLabel = { fontSize: 11.5, fontWeight: 680, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10 } as const

export function ExtensionsPanel() {
  const { extensionsOpen, closeExtensions, devMode, bumpTools, flash } = useToolbox()
  const [list, setList] = useState<InstalledPlugin[]>([])
  const [repo, setRepo] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!platform.plugins) return
    try {
      setList(await platform.plugins.list())
    } catch {
      setList([])
    }
  }, [])

  useEffect(() => {
    if (extensionsOpen) void refresh()
  }, [extensionsOpen, refresh])

  if (!extensionsOpen) return null

  const desktop = !!platform.plugins
  const after = async () => {
    await syncPlugins()
    bumpTools()
    await refresh()
  }

  const installGithub = async () => {
    const r = repo.trim()
    if (!r || busy || !platform.plugins) return
    setBusy(true)
    try {
      const res = await platform.plugins.installGithub(r)
      if (res.ok) {
        await after()
        setRepo('')
        flash('已安装 ' + (res.manifest?.name || res.id))
      } else {
        flash(res.error || '安装失败')
      }
    } finally {
      setBusy(false)
    }
  }
  const installLocal = async () => {
    if (busy || !platform.plugins) return
    setBusy(true)
    try {
      const res = await platform.plugins.installLocal()
      if (res.canceled) return
      if (res.error) {
        flash(res.error)
        return
      }
      await after()
      flash('已安装 ' + (res.manifest?.name || res.id))
    } finally {
      setBusy(false)
    }
  }
  const installLink = async () => {
    if (busy || !platform.plugins) return
    setBusy(true)
    try {
      const res = await platform.plugins.installLocalLink()
      if (res.canceled) return
      if (res.error) {
        flash(res.error)
        return
      }
      await after()
      flash('已链接 ' + (res.manifest?.name || res.id) + '（改代码后重新构建，按 Ctrl+R 重载即生效）')
    } finally {
      setBusy(false)
    }
  }
  const toggle = async (id: string, enabled: boolean) => {
    await platform.plugins!.setEnabled(id, enabled)
    await after()
  }
  const update = async (id: string, name: string) => {
    setBusy(true)
    try {
      const res = await platform.plugins!.update(id)
      if (res.ok) {
        await after()
        flash('已更新 ' + name)
      } else flash(res.error || '更新失败')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: string, name: string) => {
    await platform.plugins!.remove(id)
    await after()
    flash('已卸载 ' + name)
  }

  const pillBtn = (label: string, onClick: () => void, primary?: boolean) => (
    <span
      onClick={onClick}
      style={{ fontSize: 12, fontWeight: 540, color: primary ? '#fff' : 'var(--text2)', background: primary ? 'var(--accent)' : 'var(--pill)', padding: '5px 11px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1 }}
    >
      {label}
    </span>
  )

  return (
    <div
      onClick={closeExtensions}
      style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.32)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', animation: 'fadeIn .18s both' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: '92%', maxHeight: '86%', overflowY: 'auto', borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--hair2)', boxShadow: '0 30px 80px rgba(0,0,0,.4)', padding: 24, animation: 'fadeUp .26s both' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)' }}>扩展 · 工具插件</span>
          <span onClick={closeExtensions} className="hov-surface3" style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--pill)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontSize: 16, cursor: 'pointer' }}>×</span>
        </div>

        {!desktop ? (
          <div style={{ padding: '36px 12px', textAlign: 'center', color: 'var(--text2)', fontSize: 13.5 }}>插件安装为桌面端功能，请在桌面版中使用。</div>
        ) : (
          <>
            {/* 安装 */}
            <div style={sectionLabel}>从 GitHub 安装</div>
            <div style={{ display: 'flex', gap: 9, marginBottom: 8 }}>
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && installGithub()}
                placeholder="owner/repo（拉取最新 Release）"
                spellCheck={false}
                style={{ flex: 1, height: 38, borderRadius: 10, background: 'var(--field)', border: '1px solid var(--fieldHair)', padding: '0 13px', fontSize: 13.5, color: 'var(--text)', fontFamily: 'ui-monospace,monospace' }}
              />
              <span onClick={installGithub} style={{ display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 560, color: '#fff', background: 'var(--accent)', padding: '0 16px', borderRadius: 10, cursor: 'pointer', opacity: busy || !repo.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>{busy ? '安装中…' : '安装'}</span>
            </div>
            {devMode ? (
              <div style={{ marginBottom: 22, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', gap: 16 }}>
                  <span onClick={installLink} style={{ fontSize: 12.5, fontWeight: 540, color: 'var(--accent)', cursor: 'pointer' }}>🔗 开发者链接（实时调试）</span>
                  <span onClick={installLocal} style={{ fontSize: 12.5, fontWeight: 540, color: 'var(--text2)', cursor: 'pointer' }}>＋ 从本地文件夹安装（复制）</span>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>选择插件的 <b>dist</b> 文件夹。链接模式下改代码→重新构建→按 Ctrl+R 重载窗口即生效；F12 打开开发者工具看错误。</span>
              </div>
            ) : (
              <div style={{ marginBottom: 22, fontSize: 12, color: 'var(--text3)' }}>在设置中开启「开发者模式」可从本地 dist 文件夹安装/链接用于自测。</div>
            )}

            {/* 已安装 */}
            <div style={sectionLabel}>已安装（{list.length}）</div>
            {list.length === 0 ? (
              <div style={{ padding: '28px 12px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>还没有安装任何插件。</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.map((p) => {
                  const m = p.manifest
                  const hue = (m.hue && HUES.includes(m.hue) ? m.hue : 'gray') as HueName
                  const isGithub = p.source?.type === 'github'
                  return (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 13, background: 'var(--surface2)', border: '1px solid var(--hair)', opacity: p.enabled ? 1 : 0.55 }}>
                      <ToolIcon icon={m.icon} glyph={m.glyph || '🧩'} hue={hue} size={34} radius={9} glyphSize={14} shadow="none" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 560, color: 'var(--text)' }}>
                          {m.name} <span style={{ fontSize: 11.5, color: 'var(--text3)', fontWeight: 400 }}>v{m.version}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {isGithub ? '↗ ' + (p.source as { repo: string }).repo : p.source?.type === 'local-link' ? '🔗 本地链接' : p.source?.type === 'local' ? '本地' : ''} · {m.desc || m.cat}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                        {pillBtn(p.enabled ? '禁用' : '启用', () => toggle(m.id, !p.enabled))}
                        {isGithub && pillBtn('更新', () => update(m.id, m.name))}
                        {pillBtn('卸载', () => remove(m.id, m.name))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
