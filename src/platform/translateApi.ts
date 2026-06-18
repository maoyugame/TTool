// 翻译服务封装（默认 MyMemory，免费无密钥）。
// web 适配器直接调用；electron 主进程镜像同样逻辑以规避 CORS。
// 换用其它服务（DeepL/Google/自建）只需替换此文件，UI 与适配器接口不变。

// 应用内语言码 → MyMemory 语言码
const LANG: Record<string, string> = { zh: 'zh-CN', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr' }

export function buildTranslateUrl(text: string, from: string, to: string): string {
  const pair = `${LANG[from] ?? from}|${LANG[to] ?? to}`
  return `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`
}

export function parseTranslateResponse(data: unknown): string {
  const d = data as { responseStatus?: number; responseData?: { translatedText?: string }; responseDetails?: string }
  if (d && d.responseStatus === 200 && d.responseData && typeof d.responseData.translatedText === 'string') {
    return d.responseData.translatedText
  }
  throw new Error((d && d.responseDetails) || '翻译失败')
}

export async function translateViaMyMemory(text: string, from: string, to: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res = await fetch(buildTranslateUrl(text, from, to), { signal: ctrl.signal })
    if (!res.ok) throw new Error('翻译服务返回 ' + res.status)
    return parseTranslateResponse(await res.json())
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('翻译超时，请检查网络')
    throw e
  } finally {
    clearTimeout(timer)
  }
}
