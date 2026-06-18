import { useState, useEffect } from 'react'

// 每秒跳动的当前 Unix 时间戳（秒）。时间戳与时区工具共用。
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}
