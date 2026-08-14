import { useEffect, useRef, useState } from 'react'
import { ProgressEvent } from '../api/scan'
import { sse } from '../api/client'

// 订阅扫描进度 SSE。
//
// 返回当前进度状态，并提供 startScan() 启动新扫描。
export function useScanSSE() {
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [scanId, setScanId] = useState<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // 订阅进度
  useEffect(() => {
    if (!scanId) return
    cleanupRef.current = sse(
      `/api/scan/${scanId}/events`,
      (_eventName, data) => {
        setProgress(data as ProgressEvent)
      },
    )
    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
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
