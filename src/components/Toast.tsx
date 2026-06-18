import { useToolbox } from '../store/toolbox'

export function Toast() {
  const { toast } = useToolbox()
  if (!toast) return null
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 28,
        left: '50%',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '11px 18px',
        borderRadius: 12,
        background: 'var(--bar)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid var(--hair2)',
        boxShadow: '0 12px 30px rgba(0,0,0,.25)',
        animation: 'toastIn .25s both',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--good)' }} />
      <span style={{ fontSize: 13.5, fontWeight: 540, color: 'var(--text)' }}>{toast}</span>
    </div>
  )
}
