import { useEffect } from 'react'
import { useScanStore } from '../store/scanStore'
import { sse } from '../api/client'
import type { ProgressEvent } from '../api/scan'

// 后端用 `event: <status>` 推送，所以前端必须显式列出要监听的 event 名称。
// 与 backend/services 里的 ScanStatus 对齐。
const SCAN_EVENTS = ['pending', 'running', 'complete', 'cancelled', 'error']

// 扫描进度订阅（模块级单 EventSource + 引用计数 + 共享 store）。
//
// 设计要点：
//   - 全局只维护一个 EventSource：避免 N 个组件挂载产生 N 个连接占用后端。
//   - 订阅触发来自 useScanStore.scanId：任何组件调
//     useScanStore.getState().setActive(id) 启动扫描后，全局所有读 useScanStore
//     的视图都能看到 progress（修复了之前每个 hook 实例独立持 scanId 的 bug）。
//   - 引用计数归 0（所有订阅者都卸载）时关连接、清 store.scanId。
//   - 模块第一次被 import 时立即挂 store watcher：保证启动扫描不依赖任何 hook
//     已经挂载，store.setActive() 触发的进度会立刻被推送到所有读 store 的视图。

let currentAbort: AbortController | null = null
let subscriberCount = 0
let storeUnsub: (() => void) | null = null

function ensureStoreWatch() {
  if (storeUnsub) return
  storeUnsub = useScanStore.subscribe((state, prev) => {
    if (state.scanId === prev.scanId) return
    if (state.scanId) startSubscription(state.scanId)
    else teardownConnection()
  })
}

function startSubscription(scanId: string) {
  // 切到新 scanId 前先关旧连接
  if (currentAbort) {
    currentAbort.abort()
    currentAbort = null
  }
  const ac = new AbortController()
  currentAbort = ac

  sse(
    `/api/scan/${scanId}/events`,
    (_eventName, data) => {
      const ev = data as ProgressEvent
      useScanStore.getState().setProgress(ev)
      if (
        ev.status === 'complete' ||
        ev.status === 'cancelled' ||
        ev.status === 'error'
      ) {
        // 终态：关连接 + 清 store.scanId（保留 progress 供 UI 读最后状态）
        if (currentAbort === ac) {
          currentAbort = null
        }
        ac.abort()
        useScanStore.setState({ scanId: null })
      }
    },
    {
      events: SCAN_EVENTS,
      signal: ac.signal,
    },
  )
}

function teardownConnection() {
  if (currentAbort) {
    currentAbort.abort()
    currentAbort = null
  }
  useScanStore.getState().clear()
}

export function useScanSSE() {
  // 第一次渲染时确保 store watcher 已挂上，并参与引用计数
  useEffect(() => {
    ensureStoreWatch()
    subscriberCount++
    return () => {
      subscriberCount--
      // 最后一个订阅者卸载时关连接 + 清 store
      if (subscriberCount === 0) {
        teardownConnection()
      }
    }
  }, [])

  // 直接读 zustand store（reactive：scanId/progress 变化自动 re-render 调用方）
  const scanId = useScanStore((s) => s.scanId)
  const progress = useScanStore((s) => s.progress)

  return {
    scanId,
    progress,
    isRunning: progress?.status === 'running' || progress?.status === 'pending',
    isComplete: progress?.status === 'complete',
    isCancelled: progress?.status === 'cancelled',
    isError: progress?.status === 'error',
    // 启动扫描：写 store.scanId，模块级 watcher 自动开 EventSource。
    startWith: (id: string) => useScanStore.getState().setActive(id),
    reset: () => useScanStore.getState().clear(),
  }
}
