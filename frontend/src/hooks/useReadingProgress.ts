import { useQuery } from '@tanstack/react-query'
import { progressApi, type ReadingProgress } from '../api/prefs'

// 单条进度查询：给 Album 详情页用。
export function useReadingProgress(path: string | null | undefined) {
  return useQuery({
    queryKey: ['progress', path],
    queryFn: async () => {
      if (!path) return null
      try {
        return await progressApi.get(path)
      } catch {
        return null
      }
    },
    enabled: !!path,
    staleTime: 30 * 1000,
  })
}

// 批量进度查询：给 Home/Recents/Favorites 列表用。
// 一次 POST /api/progress/batch 拿全部，避免 N 路并发 GET。
export function useAllProgress(paths: string[]) {
  return useQuery({
    queryKey: ['progress-batch', paths],
    queryFn: async () => {
      if (paths.length === 0) return {} as Record<string, ReadingProgress>
      const r = await progressApi.batch(paths)
      return r.progress
    },
    enabled: paths.length > 0,
    staleTime: 30 * 1000,
  })
}
