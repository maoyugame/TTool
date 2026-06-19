// platform.secrets：基于 Electron safeStorage（Windows DPAPI / macOS Keychain / Linux libsecret）
// 的「加密」KV，专放秘钥 / 密码 / 账号 token。密文（base64）落盘 userData/plugins/<id>/secrets.json，
// 解决「明文落盘」问题。安全存储不可用时 set/get 返回 NO_ENCRYPTION，不退化为明文。
//
// 并发安全：同一文件读-改-写经 withFileLock 串行 + 原子写。错误回传统一 redact 脱敏（与 net 一致）。
const path = require('node:path')
const { safeStorage } = require('electron')
const { safePluginId, redact } = require('./util.cjs')
const { withFileLock, readJson, atomicWrite } = require('./jsonstore.cjs')

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
function errResp(err) {
  const code = err && err.code === 'STORE_CORRUPT' ? 'STORE_CORRUPT' : 'UNKNOWN'
  return { ok: false, code, error: redact(String((err && err.message) || err)) }
}

function setupSecrets({ ipcMain, app }) {
  const fileFor = (pluginId) => {
    const id = safePluginId(pluginId)
    if (!id) return null
    return path.join(app.getPath('userData'), 'plugins', id, 'secrets.json')
  }
  const available = () => {
    try { return safeStorage.isEncryptionAvailable() } catch { return false }
  }

  ipcMain.handle('secrets:available', () => ({ ok: true, available: available() }))

  ipcMain.handle('secrets:set', async (_e, { pluginId, key, value } = {}) => {
    const file = fileFor(pluginId)
    if (!file) return { ok: false, code: 'BAD_NS', error: '无效命名空间' }
    if (typeof key !== 'string' || !key) return { ok: false, code: 'BAD_ARGS', error: 'key 非法' }
    if (!available()) return { ok: false, code: 'NO_ENCRYPTION', error: '当前系统不支持安全加密存储' }
    try {
      await withFileLock(file, async () => {
        const o = await readJson(file)
        o[key] = safeStorage.encryptString(String(value == null ? '' : value)).toString('base64')
        await atomicWrite(file, o)
      })
      return { ok: true }
    } catch (err) {
      return errResp(err)
    }
  })

  ipcMain.handle('secrets:get', async (_e, { pluginId, key } = {}) => {
    const file = fileFor(pluginId)
    if (!file) return { ok: false, code: 'BAD_NS', error: '无效命名空间' }
    if (!available()) return { ok: false, code: 'NO_ENCRYPTION', error: '当前系统不支持安全加密存储' }
    try {
      const o = await withFileLock(file, () => readJson(file))
      if (!has(o, key)) return { ok: true, value: undefined }
      const buf = Buffer.from(String(o[key]), 'base64')
      return { ok: true, value: safeStorage.decryptString(buf) }
    } catch (err) {
      return errResp(err)
    }
  })

  ipcMain.handle('secrets:delete', async (_e, { pluginId, key } = {}) => {
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

  ipcMain.handle('secrets:keys', async (_e, { pluginId } = {}) => {
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

module.exports = { setupSecrets }
