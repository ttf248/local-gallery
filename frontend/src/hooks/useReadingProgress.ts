import { useMemo } from 'react'
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
//
// queryKey 必须对「内容相同、引用不同」的 paths 数组保持稳定。
// 早期实现用 ['progress-batch', paths]，但 React Query 的 hashKey 对 array
// 是按引用比较的（v5.62 之前），导致每次 Home/Recents/Favorites 重渲染时
// 父组件 progressPaths 都是新引用 → 触发重复 re-fetch。
// 改用排序后 join 的字符串作为 key，并按长度补充防碰撞。
export function useAllProgress(paths: string[]) {
  const stableKey = useMemo(() => {
    if (paths.length === 0) return ''
    // 排序后 join 保证顺序无关；加 length 前缀防止「[a,b]」和「[ab]」撞 key
    return `${paths.length}|${paths.slice().sort().join('|')}`
  }, [paths])
  return useQuery({
    queryKey: ['progress-batch', stableKey],
    queryFn: async () => {
      if (paths.length === 0) return {} as Record<string, ReadingProgress>
      const r = await progressApi.batch(paths)
      return r.progress
    },
    enabled: paths.length > 0,
    staleTime: 30 * 1000,
  })
}
