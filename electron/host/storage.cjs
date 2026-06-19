// platform.storage：按 pluginId 命名空间的持久化 KV（普通数据：笔记 / 配置 / 收藏）。
// 落盘 userData/plugins/<id>/data/store.json（明文 JSON——敏感数据请用 secrets）。
//
// 隔离说明（REV-6）：单 webContents 下所有插件同源，命名空间防的是「键碰撞 + 误读」，
// 不是对恶意插件的硬隔离（受信任模型）。
// 并发安全：同一文件读-改-写经 withFileLock 串行 + 原子写（防丢更新 / 防损坏静默清空）。
const path = require('node:path')
const { safePluginId, redact } = require('./util.cjs')
const { withFileLock, readJson, atomicWrite } = require('./jsonstore.cjs')

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
function errResp(err) {
  const code = err && err.code === 'STORE_CORRUPT' ? 'STORE_CORRUPT' : 'UNKNOWN'
  return { ok: false, code, error: redact(String((err && err.message) || err)) }
}

function setupStorage({ ipcMain, app }) {
  const fileFor = (pluginId) => {
    const id = safePluginId(pluginId)
    if (!id) return null
    return path.join(app.getPath('userData'), 'plugins', id, 'data', 'store.json')
  }

  ipcMain.handle('storage:get', async (_e, { pluginId, key } = {}) => {
    const file = fileFor(pluginId)
    if (!file) return { ok: false, code: 'BAD_NS', error: '无效命名空间' }
    try {
      const o = await withFileLock(file, () => readJson(file))
      return { ok: true, value: has(o, key) ? o[key] : undefined }
    } catch (err) {
      return errResp(err)
    }
  })

  ipcMain.handle('storage:set', async (_e, { pluginId, key, value } = {}) => {
    const file = fileFor(pluginId)
    if (!file) return { ok: false, code: 'BAD_NS', error: '无效命名空间' }
    if (typeof key !== 'string' || !key) return { ok: false, code: 'BAD_ARGS', error: 'key 非法' }
    try { JSON.stringify(value) } catch { return { ok: false, code: 'BAD_ARGS', error: 'value 不可序列化' } }
    try {
      await withFileLock(file, async () => {
        const o = await readJson(file)
        o[key] = value
        await atomicWrite(file, o)
      })
      return { ok: true }
    } catch (err) {
      return errResp(err)
    }
  })

  ipcMain.handle('storage:delete', async (_e, { pluginId, key } = {}) => {
    const file = fileFor(pluginId)
    if (!file) return { ok: false, code: 'BAD_NS', error: '无效命名空间' }
    try {
      await withFileLock(file, async () => {
        const o = await readJson(file)
        delete o[key]
        await atomicWrite(file, o)
      })
      return { ok: true }
    } catch (err) {
      return errResp(err)
    }
  })

  ipcMain.handle('storage:keys', async (_e, { pluginId } = {}) => {
    const file = fileFor(pluginId)
    if (!file) return { ok: false, code: 'BAD_NS', error: '无效命名空间' }
    try {
      const o = await withFileLock(file, () => readJson(file))
      return { ok: true, keys: Object.keys(o) }
    } catch (err) {
      return errResp(err)
    }
  })
}

module.exports = { setupStorage }
