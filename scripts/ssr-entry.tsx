// SSR 冒烟测试入口：实际渲染外壳 + 启动台 + 全部已注册的内置工具组件，
// 验证它们在真实 React 渲染下都不抛错，并产出预期文本。
import { createElement as e } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemeProvider } from '../src/theme/ThemeContext'
import { ToolboxProvider } from '../src/store/toolbox'
import { App } from '../src/App'
import { getAllTools } from '../src/tools/registry'

function wrap(node: React.ReactElement) {
  return e(ThemeProvider, null, e(ToolboxProvider, null, node))
}

const results: Array<[string, string | number, unknown]> = []

try {
  const html = renderToStaticMarkup(e(ThemeProvider, null, e(App)))
  const ok = /启动台/.test(html) && /JSON 格式化/.test(html) && /个工具就绪/.test(html)
  results.push(['__APP__', html.length, ok])
} catch (err) {
  results.push(['__APP__', 'ERR', err instanceof Error ? err.stack : String(err)])
}

for (const t of getAllTools()) {
  try {
    const html = renderToStaticMarkup(wrap(e(t.component)))
    results.push([t.id, html.length, html.length > 0])
  } catch (err) {
    results.push([t.id, 'ERR', err instanceof Error ? err.stack : String(err)])
  }
}

const ids = getAllTools().map((t) => t.id)
console.log('REGISTERED ' + ids.length + ' : ' + ids.join(','))
console.log(JSON.stringify(results, null, 2))

const failed = results.filter((r) => r[1] === 'ERR')
if (failed.length) {
  console.error('SSR FAILURES: ' + failed.length)
  process.exit(1)
} else {
  console.log('SSR OK: ' + results.length + ' render targets passed')
}
