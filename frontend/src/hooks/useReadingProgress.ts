import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export interface ReadingProgress {
  path: string
  index: number
  total: number
  scroll: number
  updated: string
}

// 批量拉取阅读进度。后端 /api/progress 暂为单条；
// 这里为单个 path 调用，由调用方自己聚合。
export function useReadingProgress(path: string | null | undefined) {
  return useQuery({
    queryKey: ['progress', path],
    queryFn: async () => {
      if (!path) return null
      try {
        return await api<ReadingProgress>('/api/progress', { params: { path } })
      } catch {
        return null
      }
    },
    enabled: !!path,
    staleTime: 30 * 1000,
  })
}

// 拉取最近阅读进度列表（暂时只是单条轮询的替代 — 复用 favorites 列表作为 batch
// 拉取所有 favorites 的进度）。后端暂无批量接口，这里通过并发 fetch 模拟。
export function useAllProgress(paths: string[]) {
  return useQuery({
    queryKey: ['progress-batch', paths.join('|')],
    queryFn: async () => {
      const out: Record<string, ReadingProgress> = {}
      await Promise.all(
        paths.map(async (p) => {
          try {
            const r = await api<ReadingProgress>('/api/progress', { params: { path: p } })
            out[p] = r
          } catch {
            // 忽略无进度记录
          }
        }),
      )
      return out
    },
    enabled: paths.length > 0,
    staleTime: 30 * 1000,
  })
}
