import { useEffect, useRef, useState } from 'react'
import { platform } from '../platform'
import { rankFiles } from './fileRank'
import type { FileHit } from '../platform/types'

// 「搜索本机文件」开关：与快速启动器小窗、设置面板共享同一持久化键。默认关（只搜工具）。
const KEY = 'ttool.fileSearch'

// 可执行文件扩展名（与主进程 EXEC_EXT 对应）：命中时 UI 标「可执行」、主进程打开前会二次确认。
const EXEC_EXT = new Set(['.exe', '.com', '.bat', '.cmd', '.ps1', '.msi', '.scr', '.lnk', '.vbs', '.js', '.jar', '.reg', '.hta', '.cpl', '.wsf', '.pif', '.application'])
export function isExecutableFile(name: string): boolean {
  const i = name.lastIndexOf('.')
  return i >= 0 && EXEC_EXT.has(name.slice(i).toLowerCase())
}

export function isFileSearchOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
export function setFileSearchOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

// 防抖的本机文件搜索 hook。enabled 为 false 或无 searchFiles 能力时恒返回空。
// 用递增的请求序号丢弃过期响应，避免乱序覆盖。
export function useFileSearch(query: string, enabled: boolean): { hits: FileHit[]; loading: boolean } {
  const [hits, setHits] = useState<FileHit[]>([])
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (!enabled || !platform.searchFiles || q.length < 2) {
      seq.current++ // 作废在途请求，保证 enabled=false 后过期响应不再写回
      setHits([])
      setLoading(false)
      return
    }
    const my = ++seq.current
    setLoading(true)
    const arr = (r: unknown): FileHit[] => (Array.isArray(r) ? (r as FileHit[]) : [])
    // 索引(快，覆盖 C 盘/已索引位置)与深度扫描(慢，其它固定盘)并行；各自返回即合并重排，
    // 实现「C 盘即时出结果、其它盘稍后补入」。两者都受 seq 守卫，过期响应丢弃。
    let base: FileHit[] = []
    let more: FileHit[] = []
    const apply = () => {
      if (my === seq.current) setHits(rankFiles([...base, ...more], q, 20))
    }
    const timer = setTimeout(() => {
      const tasks: Promise<unknown>[] = [
        platform.searchFiles!(q).then((r) => { if (my === seq.current) { base = arr(r); apply() } }).catch(() => {}),
      ]
      if (platform.searchFilesDeep) {
        tasks.push(platform.searchFilesDeep(q).then((r) => { if (my === seq.current) { more = arr(r); apply() } }).catch(() => {}))
      }
      Promise.allSettled(tasks).then(() => { if (my === seq.current) setLoading(false) })
    }, 250)
    return () => clearTimeout(timer)
  }, [query, enabled])

  return { hits, loading }
}
