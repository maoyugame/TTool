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
  // 当前窗口模式：主窗 or 快速启动器小窗（按 URL hash 区分）
  mode: location.hash === '#launcher' ? 'launcher' : 'main',
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
  // 主窗订阅：启动器小窗请求打开某工具
  onOpenTool: (cb) => {
    const h = (_e, id) => cb(id)
    ipcRenderer.on('ttool:open-tool', h)
    return () => ipcRenderer.removeListener('ttool:open-tool', h)
  },
  // 快速启动器路由（小窗用）
  launcher: {
    hide: () => ipcRenderer.invoke('launcher:hide'),
    openTool: (id) => ipcRenderer.invoke('launcher:openTool', { id }),
    resize: (height) => ipcRenderer.invoke('launcher:resize', { height }),
  },
  // 本机文件搜索 / 打开
  files: {
    search: (query) => ipcRenderer.invoke('files:search', { query }),
    searchDeep: (query) => ipcRenderer.invoke('files:searchDeep', { query }),
    open: (path) => ipcRenderer.invoke('files:open', { path }),
    reveal: (path) => ipcRenderer.invoke('files:reveal', { path }),
  },
  // 插件管理
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    installGithub: (repo, tag) => ipcRenderer.invoke('plugins:installGithub', { repo, tag }),
    installLocal: () => ipcRenderer.invoke('plugins:installLocal'),
    installLocalLink: () => ipcRenderer.invoke('plugins:installLocalLink'),
    remove: (id) => ipcRenderer.invoke('plugins:remove', { id }),
    setEnabled: (id, enabled) => ipcRenderer.invoke('plugins:setEnabled', { id, enabled }),
    update: (id) => ipcRenderer.invoke('plugins:update', { id }),
    readBundle: (id) => ipcRenderer.invoke('plugins:readBundle', { id }),
  },
  // 通用 TCP/TLS 字节管道（任意协议插件用；事件订阅返回取消订阅函数）
  net: {
    connect: (opts) => ipcRenderer.invoke('net:connect', opts),
    write: (socketId, data) => ipcRenderer.invoke('net:write', { socketId, data }),
    close: (socketId) => ipcRenderer.invoke('net:close', { socketId }),
    onData: (socketId, cb) => {
      const ch = 'net:data:' + socketId
      const h = (_e, chunk) => cb(chunk)
      ipcRenderer.on(ch, h)
      return () => ipcRenderer.removeListener(ch, h)
    },
    onClose: (socketId, cb) => {
      const ch = 'net:close:' + socketId
      const h = (_e, info) => cb(info)
      ipcRenderer.on(ch, h)
      return () => ipcRenderer.removeListener(ch, h)
    },
    onError: (socketId, cb) => {
      const ch = 'net:error:' + socketId
      const h = (_e, err) => cb(err)
      ipcRenderer.on(ch, h)
      return () => ipcRenderer.removeListener(ch, h)
    },
    onDrain: (socketId, cb) => {
      const ch = 'net:drain:' + socketId
      const h = () => cb()
      ipcRenderer.on(ch, h)
      return () => ipcRenderer.removeListener(ch, h)
    },
  },
  // 按插件命名空间的持久化 KV（普通数据）
  storage: {
    get: (pluginId, key) => ipcRenderer.invoke('storage:get', { pluginId, key }),
    set: (pluginId, key, value) => ipcRenderer.invoke('storage:set', { pluginId, key, value }),
    delete: (pluginId, key) => ipcRenderer.invoke('storage:delete', { pluginId, key }),
    keys: (pluginId) => ipcRenderer.invoke('storage:keys', { pluginId }),
  },
  // safeStorage 加密 KV（秘钥 / 密码 / 账号）
  secrets: {
    available: () => ipcRenderer.invoke('secrets:available'),
    get: (pluginId, key) => ipcRenderer.invoke('secrets:get', { pluginId, key }),
    set: (pluginId, key, value) => ipcRenderer.invoke('secrets:set', { pluginId, key, value }),
    delete: (pluginId, key) => ipcRenderer.invoke('secrets:delete', { pluginId, key }),
    keys: (pluginId) => ipcRenderer.invoke('secrets:keys', { pluginId }),
  },
  // 数据库便利层（主进程持驱动；位置参数 → payload）
  db: {
    mysql: {
      connect: (config) => ipcRenderer.invoke('db:mysql:connect', config),
      query: (connId, sql, params) => ipcRenderer.invoke('db:mysql:query', { connId, sql, params }),
      close: (connId) => ipcRenderer.invoke('db:mysql:close', { connId }),
      ping: (connId) => ipcRenderer.invoke('db:mysql:ping', { connId }),
    },
    redis: {
      connect: (config) => ipcRenderer.invoke('db:redis:connect', config),
      command: (connId, args, opts) => ipcRenderer.invoke('db:redis:command', { connId, args, opts }),
      pipeline: (connId, cmds) => ipcRenderer.invoke('db:redis:pipeline', { connId, cmds }),
      close: (connId) => ipcRenderer.invoke('db:redis:close', { connId }),
      ping: (connId) => ipcRenderer.invoke('db:redis:ping', { connId }),
    },
    mongo: {
      connect: (config) => ipcRenderer.invoke('db:mongo:connect', config),
      listDatabases: (connId) => ipcRenderer.invoke('db:mongo:listDatabases', { connId }),
      listCollections: (connId, db) => ipcRenderer.invoke('db:mongo:listCollections', { connId, db }),
      find: (connId, db, coll, opts) => ipcRenderer.invoke('db:mongo:find', { connId, db, coll, opts }),
      countDocuments: (connId, db, coll, filter) => ipcRenderer.invoke('db:mongo:countDocuments', { connId, db, coll, filter }),
      aggregate: (connId, db, coll, pipeline, opts) => ipcRenderer.invoke('db:mongo:aggregate', { connId, db, coll, pipeline, opts }),
      distinct: (connId, db, coll, field, filter, options) => ipcRenderer.invoke('db:mongo:distinct', { connId, db, coll, field, filter, options }),
      insertOne: (connId, db, coll, doc) => ipcRenderer.invoke('db:mongo:insertOne', { connId, db, coll, doc }),
      insertMany: (connId, db, coll, docs) => ipcRenderer.invoke('db:mongo:insertMany', { connId, db, coll, docs }),
      updateOne: (connId, db, coll, filter, update, opts) => ipcRenderer.invoke('db:mongo:updateOne', { connId, db, coll, filter, update, opts }),
      updateMany: (connId, db, coll, filter, update, opts) => ipcRenderer.invoke('db:mongo:updateMany', { connId, db, coll, filter, update, opts }),
      replaceOne: (connId, db, coll, filter, update, opts) => ipcRenderer.invoke('db:mongo:replaceOne', { connId, db, coll, filter, update, opts }),
      deleteOne: (connId, db, coll, filter) => ipcRenderer.invoke('db:mongo:deleteOne', { connId, db, coll, filter }),
      deleteMany: (connId, db, coll, filter) => ipcRenderer.invoke('db:mongo:deleteMany', { connId, db, coll, filter }),
      listIndexes: (connId, db, coll) => ipcRenderer.invoke('db:mongo:listIndexes', { connId, db, coll }),
      createIndex: (connId, db, coll, keys, opts) => ipcRenderer.invoke('db:mongo:createIndex', { connId, db, coll, keys, opts }),
      dropIndex: (connId, db, coll, name) => ipcRenderer.invoke('db:mongo:dropIndex', { connId, db, coll, name }),
      runCommand: (connId, db, command) => ipcRenderer.invoke('db:mongo:runCommand', { connId, db, command }),
      close: (connId) => ipcRenderer.invoke('db:mongo:close', { connId }),
      ping: (connId) => ipcRenderer.invoke('db:mongo:ping', { connId }),
    },
  },
})
