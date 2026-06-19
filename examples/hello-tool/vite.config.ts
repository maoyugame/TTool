import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// 工具插件构建：库模式输出单个 IIFE bundle；react / sdk 标为 external 映射到宿主全局，
// 因此 bundle 不打包 React/SDK，运行时复用宿主单例。
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
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
      external: ['react', 'react-dom', 'react/jsx-runtime', '@maoyugame/ttool-sdk'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'ReactJsxRuntime',
          '@maoyugame/ttool-sdk': 'TToolSDK',
        },
        entryFileNames: 'tool.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
})
