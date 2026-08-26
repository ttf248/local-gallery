import { useMemo } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import { useAllProgress } from './useReadingProgress'
import { useFavorites } from './useFavorites'
import type { CardData } from '../components/album/AlbumGrid'
import type { ReadingProgress } from '../api/prefs'
import { albumRoute } from '../utils/path'
import { isUnread } from '../utils/progress'
import { buildLibraryIndex } from '../utils/libraryIndex'

// useUnreadAlbums 给出当前未读(还没看 / 刚打开)的所有相册,按需携带
// 收藏状态。返回值与 AlbumGrid 直接对接。
//
// 「未读」语义集中在 utils/progress.isUnread:
//   - 没有 progress 记录
//   - 或 progress.total === 0
//   - 或 progress.index <= 0(刚翻到第 0 张算刚开始,不算「已读」)
//   - index >= total(已读完) 不算未读,也不该再进「继续阅读」
//
// 调用方拿到 cards 后可自由 sort / filter(各 page 行为不同)。
//
// 设计要点:
//  1. 仅依赖全局 library + progress + favorites;不另起 SSE。
//  2. progress 拿全库 → 后续 Recents/Favorites 也想复用时可单独抽 store;
//     这里不抢公共状态,避免「A 改了 unread list,B 的 progress 也被刷」这种
//     隐式耦合。
//  3. 收藏状态在 cards 阶段就合并,调用方不用再处理 (path → fav) 映射。
interface UseUnreadAlbumsOptions {
  progressMap?: Record<string, ReadingProgress>
  loadProgress?: boolean
}

export function useUnreadAlbums(options: UseUnreadAlbumsOptions = {}): {
  cards: CardData[]
  count: number
  total: number
  isLoading: boolean
} {
  const result = useLibraryStore((s) => s.result)
  const { favorites } = useFavorites()
  const favSet = useMemo(() => new Set(favorites), [favorites])
  const libraryIndex = useMemo(() => buildLibraryIndex(result), [result])

  // 批量拿全库的 progress。注意:只发当前库里的相册 ID,避免传一堆
  // 已被 prune 掉的旧 ID(后端 batch 会跳过不存在的 key,但前端少发点
  // payload 也好)。
  const albumIds = libraryIndex.albumIds

  const progressQuery = useAllProgress(albumIds, options.loadProgress ?? true)
  const progressMap = options.progressMap ?? progressQuery.data

  const cards = useMemo<CardData[]>(() => {
    if (!result) return []
    const out: CardData[] = []
    for (const a of libraryIndex.albumsById.values()) {
      const p = progressMap?.[a.path]
      // 跟 utils/progress.isInProgress 互斥:这里「未读」= 既不在读、也非已读完
      // (实际就是 isUnread 的反义,但 isUnread 也把「total=0 空相册」算进去 —
      //  空相册不丢,继续按未读展示)。
      const isFresh = isUnread(p)
      if (!isFresh) continue
      // 即便是 isFresh(还没读)也把 progress 字段填上 — AlbumCard 用它
      // 决定「标记为已读」菜单项是否可点。未读卡片要能右键直接标已读,
      // 没有 progress 字段就弹不出菜单,所以这里用图+视频总数做 total,
      // index=0 表示还没翻。这样右键 → set(total, total) 即视为读完。
      const total = a.imageCount + (a.videoCount ?? 0)
      out.push({
        id: 'u:' + a.path,
        variant: 'album',
        title: a.name,
        subtitle: a.author || undefined,
        count: a.imageCount,
        imageCount: a.imageCount,
        videoCount: a.videoCount ?? 0,
        coverPath: a.coverImage,
        coverKind: a.coverKind,
        to: albumRoute(a.path),
        isFavorite: favSet.has(a.path),
        progress: { index: 0, total },
      })
    }
    return out
  }, [result, libraryIndex, progressMap, favSet])

  return {
    cards,
    count: cards.length,
    total: libraryIndex.albumIds.length,
    isLoading:
      (options.loadProgress === false
        ? options.progressMap === undefined
        : progressQuery.isLoading) && cards.length === 0,
  }
}
