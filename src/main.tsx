import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { QuickLauncher } from './components/QuickLauncher'
import { ThemeProvider } from './theme/ThemeContext'
import { installSdkGlobals } from './sdk'
import { platform } from './platform'
import './styles/tokens.css'

// 在渲染与加载任何插件之前，暴露共享单例供外部插件复用。
installSdkGlobals()

// 快速启动器小窗（#launcher）渲染紧凑启动器；主窗口渲染完整应用。
const isLauncher = platform.mode === 'launcher'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>{isLauncher ? <QuickLauncher /> : <App />}</ThemeProvider>
  </React.StrictMode>
)
