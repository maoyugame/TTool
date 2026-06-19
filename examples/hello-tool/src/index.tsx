// 示例外部工具插件。独立项目独立构建，产出 IIFE bundle，由宿主动态加载。
// 作者只依赖 @maoyugame/ttool-sdk —— 运行时复用宿主的 React 与 SDK 实例。
import { defineTool, ToolPage, ToolHeader, usePersistentState, useToolbox, MONO } from '@maoyugame/ttool-sdk'

function HelloTool() {
  const { copy } = useToolbox()
  const [name, setName] = usePersistentState('hello.name', 'TTool')
  const greeting = `你好，${name}！这是来自外部插件的问候 👋`
  return (
    <ToolPage scroll>
      <ToolHeader glyph="👋" hue="green" title="Hello 插件" subtitle="一个独立构建、动态安装的示例插件" />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        spellCheck={false}
        style={{ width: '100%', height: 46, borderRadius: 12, background: 'var(--field)', border: '1px solid var(--fieldHair)', padding: '0 15px', fontSize: 15, color: 'var(--text)' }}
      />
      <div style={{ marginTop: 18, fontSize: 18, color: 'var(--text)', fontFamily: MONO }}>{greeting}</div>
      <div
        onClick={() => copy(greeting, '问候')}
        style={{ marginTop: 18, display: 'inline-flex', fontSize: 13, fontWeight: 560, color: '#fff', background: 'var(--accent)', padding: '9px 18px', borderRadius: 10, cursor: 'pointer' }}
      >
        复制问候
      </div>
    </ToolPage>
  )
}

defineTool({
  id: 'hello',
  name: 'Hello 插件',
  desc: '示例外部插件 · 独立构建、动态安装',
  glyph: '👋',
  cat: '插件',
  hue: 'green',
  order: 100,
  keywords: 'hello demo shili',
  component: HelloTool,
})
