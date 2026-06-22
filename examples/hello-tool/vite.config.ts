import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 把 manifest.json（及其 icon）复制进 dist/，使 dist/ 成为「自包含插件包」：
// dist/ 内 manifest.json 与 tool.js 同层，manifest.entry='tool.js' 可正确解析。
// 这样无论本地安装（选 dist/ 文件夹）还是 GitHub Release（上传 dist/* 资产）布局一致。
// build 与 dev(--watch) 都会触发，保证 dist/ 始终完整。
function copyManifest() {
  const dir = fileURLToPath(new URL('.', import.meta.url))
  return {
    name: 'ttool-copy-manifest',
    closeBundle() {
      const out = resolve(dir, 'dist')
      const mf = resolve(dir, 'manifest.json')
      copyFileSync(mf, resolve(out, 'manifest.json'))
      try {
        const m = JSON.parse(readFileSync(mf, 'utf8'))
        if (m.icon && !/^data:/.test(m.icon)) {
          const src = resolve(dir, m.icon)
          if (existsSync(src)) copyFileSync(src, resolve(out, m.icon.split('/').pop()))
        }
      } catch {
        /* manifest 无 icon 或解析失败时忽略 */
      }
    },
  }
}

// 工具插件构建：库模式输出单个 IIFE bundle；react / sdk 标为 external 映射到宿主全局，
// 因此 bundle 不打包 React/SDK，运行时复用宿主单例。
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), copyManifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/index.tsx',
      formats: ['iife'],
      name: 'HelloTool',
      fileName: () => 'tool.js',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', '@maoyugames/ttool-sdk'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'ReactJsxRuntime',
          '@maoyugames/ttool-sdk': 'TToolSDK',
        },
        entryFileNames: 'tool.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
})
