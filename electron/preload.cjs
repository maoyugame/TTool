// 预加载脚本：通过 contextBridge 把受控的桌面能力暴露到 window.ttool。
// 渲染进程的 electron 平台适配器（src/platform/electron.ts）只消费这个接口，
// 从不直接接触 Node / ipcRenderer，保证核心应用与运行时解耦。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ttool', {
  platform: 'electron',
  os: process.platform,
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternalApp: (path) => ipcRenderer.invoke('app:open', path),
  pickAppPath: () => ipcRenderer.invoke('dialog:pickApp'),
  windowMinimize: () => ipcRenderer.invoke('win:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
  windowClose: () => ipcRenderer.invoke('win:close'),
  translate: (text, from, to) => ipcRenderer.invoke('translate', { text, from, to }),
  // 事件订阅：返回取消订阅函数
  onSummon: (cb) => {
    const h = () => cb()
    ipcRenderer.on('ttool:summon', h)
    return () => ipcRenderer.removeListener('ttool:summon', h)
  },
  onWindowFocus: (cb) => {
    const h = () => cb()
    ipcRenderer.on('ttool:window-focus', h)
    return () => ipcRenderer.removeListener('ttool:window-focus', h)
  },
  // 插件管理
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    installGithub: (repo, tag) => ipcRenderer.invoke('plugins:installGithub', { repo, tag }),
    installLocal: () => ipcRenderer.invoke('plugins:installLocal'),
    remove: (id) => ipcRenderer.invoke('plugins:remove', { id }),
    setEnabled: (id, enabled) => ipcRenderer.invoke('plugins:setEnabled', { id, enabled }),
    update: (id) => ipcRenderer.invoke('plugins:update', { id }),
    readBundle: (id) => ipcRenderer.invoke('plugins:readBundle', { id }),
  },
})
