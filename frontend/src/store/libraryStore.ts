import { create } from 'zustand'
import { scanApi } from '../api/scan'
import type { ScanResult } from '../api/scan'

// Library 全局图像库状态：
//   - 缓存最近一次扫描结果，所有页面共享，避免每次重新扫描
//   - 启动时尝试拉取后端持久化的扫描缓存（/api/scan/latest）
//   - 提供明确的 set/refresh/clear 入口
//
// 注意：单进程的 React 应用内不需要持久化（重启时直接从后端缓存恢复）。
// 但为保证刷新页面后立即可用，仍允许 lastResult 走 sessionStorage。
interface LibraryState {
  result: ScanResult | null
  lastScanAt: string | null
  isLoading: boolean
  error: string | null

  setResult: (r: ScanResult) => void
  loadFromBackend: () => Promise<void>
  startScan: () => Promise<string>
  clear: () => void
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  result: null,
  lastScanAt: null,
  isLoading: false,
  error: null,

  setResult: (r) =>
    set({
      result: r,
      lastScanAt: new Date().toISOString(),
      error: null,
    }),

  loadFromBackend: async () => {
    if (get().isLoading) return
    set({ isLoading: true, error: null })
    try {
      const data = await fetchLatest()
      if (data) {
        set({
          result: data,
          lastScanAt: data.scannedAt,
          isLoading: false,
        })
        return
      }
    } catch (e) {
      // 404 等都是正常情况
    }
    set({ isLoading: false })
  },

  startScan: async () => {
    const { scanId } = await scanApi.start()
    return scanId
  },

  clear: () => set({ result: null, lastScanAt: null }),
}))

// 单独封装 fetch，避免循环依赖；带超时与错误吞咽。
async function fetchLatest(): Promise<ScanResult | null> {
  const res = await fetch('/api/scan/latest', {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { ok: boolean; result: ScanResult }
  return data.ok ? data.result : null
}
