import type { Platform } from './types'
import { translateViaMyMemory } from './translateApi'

// 纯浏览器适配器（默认）。无桌面能力的地方给出优雅降级，保证核心应用始终可运行。
export const webPlatform: Platform = {
  kind: 'web',
  isDesktop: false,
  mode: 'main', // web 无独立启动器小窗

  async copyText(text: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return
      }
    } catch {
      /* 回退到 execCommand */
    }
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {
      /* 浏览器禁止复制时静默忽略 */
    }
  },

  async openExternalApp() {
    // 浏览器无法启动本地应用。
    return { ok: false, error: '浏览器环境不支持启动本地应用，请在桌面版中使用' }
  },

  async pickAppPath() {
    return { canceled: true }
  },

  window: {
    minimize() {},
    toggleMaximize() {},
    close() {},
  },

  // 浏览器直连翻译：优先用页面注入的 window.claude（如 Claude 设计环境），否则用免费的 MyMemory。
  translate: async (text, from, to) => {
    const names: Record<string, string> = { zh: '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语' }
    if (window.claude?.complete) {
      const prompt = `Translate from ${names[from] ?? from} to ${names[to] ?? to}. Output only the translation, nothing else:\n\n${text}`
      const out = await window.claude.complete(prompt)
      return out.trim()
    }
    return translateViaMyMemory(text, from, to)
  },
}
