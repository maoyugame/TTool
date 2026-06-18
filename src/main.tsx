import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ThemeProvider } from './theme/ThemeContext'
import { installSdkGlobals } from './sdk'
import './styles/tokens.css'

// 在渲染与加载任何插件之前，暴露共享单例供外部插件复用。
installSdkGlobals()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
)
