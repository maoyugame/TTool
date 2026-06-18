import { iconBg, iconShadow, headerIconShadow, type HueName } from '../tools/hue'

interface Props {
  icon?: string // 生成的图标图片 URL（含 alpha 的 squircle）
  glyph: string // 无图片时回退的文字字形
  hue: HueName
  size: number
  radius: number
  glyphSize: number
  glyphWeight?: number
  shadow?: 'list' | 'header' | 'none'
}

// 工具图标：优先用生成的图片（透明 squircle，drop-shadow 跟随形状），
// 无图片时回退到"渐变圆角方块 + 文字字形"。卡片/标签/最近/详情头部共用。
export function ToolIcon({ icon, glyph, hue, size, radius, glyphSize, glyphWeight = 600, shadow = 'list' }: Props) {
  const sh = shadow === 'none' ? 'none' : shadow === 'header' ? headerIconShadow(hue) : iconShadow(hue)
  if (icon) {
    // 整幅方形图标，用 CSS 圆角裁成 squircle 外观。
    return (
      <img
        src={icon}
        width={size}
        height={size}
        alt=""
        style={{
          display: 'block',
          objectFit: 'cover',
          borderRadius: radius,
          boxShadow: sh,
          flexShrink: 0,
        }}
      />
    )
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: iconBg(hue),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: glyphSize,
        fontWeight: glyphWeight,
        boxShadow: sh,
        flexShrink: 0,
      }}
    >
      {glyph}
    </span>
  )
}
