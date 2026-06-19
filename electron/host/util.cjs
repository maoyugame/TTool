// host 能力共享工具：命名空间校验 + 凭证脱敏。
// 供 net / storage / secrets / index 复用。

// 校验插件命名空间 id：只允许字母数字与 . _ -，禁止 . / .. / 含 .. 的路径穿越。
// 返回合法 id，或 null（非法）。用于把 pluginId 安全地拼成单段目录名。
function safePluginId(id) {
  if (typeof id !== 'string') return null
  if (id === '' || id === '.' || id === '..') return null
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null
  if (id.includes('..')) return null
  return id
}

// 对任何要写入日志 / 错误 / IPC 回传的字符串做凭证脱敏：
// 把 URI 里 userinfo 段的口令替换为 ***（如 redis://u:secret@h → redis://u:***@h）。
// userinfo 贪婪匹配到 host 前的最后一个 @，因此覆盖：
//   - 密码含 @（mysql://root:p@ss@db → mysql://root:***@db）
//   - 空用户名（redis://:onlypass@host → redis://:***@host，redis 常见写法）
function redact(s) {
  return String(s == null ? '' : s).replace(
    /(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s]*@)/gi,
    (m, scheme, userinfoAt) => {
      const userinfo = userinfoAt.slice(0, -1) // 去掉结尾 @
      const colon = userinfo.indexOf(':')
      if (colon === -1) return m // 仅用户名无口令段，原样保留
      return scheme + userinfo.slice(0, colon) + ':***@'
    }
  )
}

module.exports = { safePluginId, redact }
