import { create } from 'zustand'
import type { ProgressEvent } from '../api/scan'

// 扫描状态共享 store：
//   - 单一来源：所有「当前扫描进度 / 状态」走这里
//   - 单 SSE 连接：模块层管理一个 EventSource（hooks/useScanSSE.ts）
//   - 写：setActive(id) 启动 / clear() 结束（订阅自动跟随）
//
// 调用方不直接订阅 SSE,只读写 store 即可：
//   const { progress, isRunning } = useScanStore()
//   useScanStore.getState().setActive(scanId)

export type ScanStatus = ProgressEvent['status']

interface ScanState {
  scanId: string | null
  progress: ProgressEvent | null
  setActive: (id: string) => void
  setProgress: (p: ProgressEvent) => void
  clear: () => void
}

export const useScanStore = create<ScanState>((set) => ({
  scanId: null,
  progress: null,
  setActive: (id) => set({ scanId: id, progress: null }),
  setProgress: (p) => set({ progress: p }),
  clear: () => set({ scanId: null, progress: null }),
}))
