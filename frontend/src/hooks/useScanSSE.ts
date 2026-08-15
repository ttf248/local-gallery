import { useEffect, useRef, useState } from 'react'
import { ProgressEvent } from '../api/scan'
import { sse } from '../api/client'

// 后端用 `event: <status>` 推送，所以前端必须显式列出要监听的 event 名称。
// 与 backend/services 里的 ScanStatus 对齐。
const SCAN_EVENTS = ['pending', 'running', 'complete', 'cancelled', 'error']

// 订阅扫描进度 SSE。
//
// 返回当前进度状态，并提供 startScan() 启动新扫描。
//
// 行为说明：
//   - 调用 startWith(id) 启动订阅；重复调用会先关旧连接。
//   - 收到 status === 'complete' / 'cancelled' / 'error' 后自动关闭连接，
//     避免长连接泄漏。
//   - 组件卸载时也会自动关闭。
export function useScanSSE() {
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [scanId, setScanId] = useState<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 订阅进度
  useEffect(() => {
    if (!scanId) return
    // 启动新订阅前先关旧的
    cleanupRef.current?.()
    cleanupRef.current = null

    const ac = new AbortController()
    abortRef.current = ac

    cleanupRef.current = sse(
      `/api/scan/${scanId}/events`,
      (_eventName, data) => {
        const ev = data as ProgressEvent
        setProgress(ev)
        // 终态：关闭连接
        if (
          ev.status === 'complete' ||
          ev.status === 'cancelled' ||
          ev.status === 'error'
        ) {
          ac.abort()
          cleanupRef.current?.()
          cleanupRef.current = null
        }
      },
      {
        events: SCAN_EVENTS,
        signal: ac.signal,
      },
    )

    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
      ac.abort()
    }
  }, [scanId])

  function startWith(id: string) {
    setScanId(id)
    setProgress(null)
  }

  function reset() {
    setScanId(null)
    setProgress(null)
  }

  return {
    scanId,
    progress,
    startWith,
    reset,
    isRunning: progress?.status === 'running',
    isComplete: progress?.status === 'complete',
    isCancelled: progress?.status === 'cancelled',
    isError: progress?.status === 'error',
  }
}
