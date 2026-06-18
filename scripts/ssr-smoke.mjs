// 用 Vite 的 SSR 构建打包 ssr-entry（原生支持 import.meta.glob 自动发现 + png 资源 + jsx），
// 再在 Node 中运行，实现"无浏览器"的真实渲染冒烟测试。
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

await build({
  configFile: false,
  logLevel: 'error',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  build: {
    ssr: join(here, 'ssr-entry.tsx'),
    outDir: join(here, '.ssr-out'),
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'ssr-entry.mjs' } },
  },
})

await import('./.ssr-out/ssr-entry.mjs')
