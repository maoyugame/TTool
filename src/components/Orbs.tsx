// 背景缓慢漂移的两团光晕（毛玻璃氛围）。
export function Orbs() {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: -160,
          left: -120,
          width: 520,
          height: 520,
          borderRadius: '50%',
          background: 'radial-gradient(circle,rgba(99,102,241,.5),transparent 68%)',
          filter: 'blur(46px)',
          opacity: 'var(--orb)',
          animation: 'drift 16s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -200,
          right: -120,
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle,rgba(217,70,160,.4),transparent 68%)',
          filter: 'blur(52px)',
          opacity: 'var(--orb)',
          animation: 'driftB 19s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />
      {/* 中央极光：缓慢呼吸 + 色相流动，给首页增加活气 */}
      <div
        style={{
          position: 'absolute',
          top: '44%',
          left: '50%',
          width: 760,
          height: 760,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(120,140,255,.32), rgba(217,70,160,.16) 46%, transparent 70%)',
          opacity: 'calc(var(--orb) * .8)',
          animation: 'auroraPulse 14s ease-in-out infinite, hueFlow 44s linear infinite',
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />
    </>
  )
}
