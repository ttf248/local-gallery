import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { progressApi, type ReadingProgress } from '../api/prefs'

// 单条进度查询：给 Album 详情页用。
export function useReadingProgress(albumId: string | null | undefined) {
  return useQuery({
    queryKey: ['progress', albumId],
    queryFn: async () => {
      if (!albumId) return null
      try {
        return await progressApi.get(albumId)
      } catch {
        return null
      }
    },
    enabled: !!albumId,
    staleTime: 30 * 1000,
  })
}

// 批量进度查询：给 Home/Recents/Favorites 列表用。
// 一次 POST /api/progress/batch 拿全部，避免 N 路并发 GET。
//
// queryKey 必须对「内容相同、引用不同」的 albumIds 数组保持稳定。
// 早期实现用 ['progress-batch', albumIds]，但 React Query 的 hashKey 对 array
// 是按引用比较的（v5.62 之前），导致每次 Home/Recents/Favorites 重渲染时
// 父组件 progressPaths 都是新引用 → 触发重复 re-fetch。
// 改用排序后 join 的字符串作为 key，并按长度补充防碰撞。
export function useAllProgress(albumIds: string[]) {
  const stableKey = useMemo(() => {
    if (albumIds.length === 0) return ''
    // 排序后 join 保证顺序无关；加 length 前缀防止「[a,b]」和「[ab]」撞 key
    return `${albumIds.length}|${albumIds.slice().sort().join('|')}`
  }, [albumIds])
  return useQuery({
    queryKey: ['progress-batch', stableKey],
    queryFn: async () => {
      if (albumIds.length === 0) return {} as Record<string, ReadingProgress>
      const r = await progressApi.batch(albumIds)
      return r.progress
    },
    enabled: albumIds.length > 0,
    staleTime: 30 * 1000,
  })
}

// 「继续阅读」单本删除：进度用 key=['progress', albumId]，批量用 ['progress-batch', ...]，
// 还有 Recents/Favorites 里 per-album 详情也用 ['progress', albumId]，
// invalidate 这三组足以让所有视图同步。
export function useDeleteProgress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (albumId: string) => progressApi.delete(albumId),
    onSuccess: (_data, albumId) => {
      qc.invalidateQueries({ queryKey: ['progress-batch'] })
      qc.invalidateQueries({ queryKey: ['progress', albumId] })
      qc.invalidateQueries({ queryKey: ['progress'] })
    },
  })
}

// 「继续阅读」一键清空：所有 albumId 都失效。invalidateQueries 不带 predicate
// 会匹配 ['progress-batch', ...] / ['progress', albumId] / ['progress'] 全部。
export function useClearAllProgress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => progressApi.clearAll(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['progress-batch'] })
      qc.invalidateQueries({ queryKey: ['progress'] })
    },
  })
}

// 「未读」单本标记已读：把 progress.index 推到 total（= 视作已读完）。
// 首页「未读」hero 的 X 按钮和 AlbumCard 右键菜单的「标记为已读」都走这个。
// 复用 progressApi.set 而非 progressApi.delete 的考虑：
//   - 「未读」的语义是 progress.index<=0，最干净的"读完"是把 index 推到 total，
//     这样未来 Recents / Favorites / Album 详情里也能看到"看完了"的轨迹；
//   - 完全删除 progress 记录会丢失历史，跟右键「标记为已读」行为不一致。
//   失效范围与 useDeleteProgress 一致（progress-batch + progress）。
export function useMarkAsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ albumId, total }: { albumId: string; total: number }) =>
      progressApi.set(albumId, total, total, 0),
    onSuccess: (_data, { albumId }) => {
      qc.invalidateQueries({ queryKey: ['progress-batch'] })
      qc.invalidateQueries({ queryKey: ['progress', albumId] })
      qc.invalidateQueries({ queryKey: ['progress'] })
    },
  })
}

// 「未读」一键全部标记已读：单请求、单次原子落盘。
export function useMarkAllAsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (items: { albumId: string; total: number }[]) => {
      const result = await progressApi.setBatch(
        items.map((item) => ({
          albumId: item.albumId,
          index: item.total,
          total: item.total,
          scroll: 0,
        })),
      )
      return { ok: result.updated, failed: 0, total: items.length }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['progress-batch'] })
      qc.invalidateQueries({ queryKey: ['progress'] })
    },
  })
}
