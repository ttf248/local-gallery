import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useLibraryStore } from '../store/libraryStore'
import { useSearchStore } from '../store/searchStore'
import { useUIStore } from '../store/uiStore'
import { favoritesApi } from '../api/prefs'
import { useFavorites } from '../hooks/useFavorites'
import { useAllProgress } from '../hooks/useReadingProgress'
import AlbumGrid, { type CardData } from '../components/album/AlbumGrid'
import EmptyState from '../components/common/EmptyState'
import { StarIcon } from '../components/common/Icon'
import { albumRoute, authorRoute } from '../utils/path'

// 收藏页：合并 albums + smart collections 中的收藏。
// 支持搜索 + 排序 + 阅读进度展示。
export default function Favorites() {
  const navigate = useNavigate()
  const result = useLibraryStore((s) => s.result)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)
  const viewMode = useUIStore((s) => s.viewMode)
  const query = useSearchStore((s) => s.query)
  const sortBy = useSearchStore((s) => s.sortBy)
  const { favorites } = useFavorites()

  useEffect(() => {
    if (!result) loadFromBackend()
  }, [result, loadFromBackend])

  // 单个 favorites API 会返回 stale；这里以 useFavorites 缓存为准
  useFavorites()
  void useQuery({
    queryKey: ['favorites'],
    queryFn: () => favoritesApi.list(),
    staleTime: 10 * 1000,
  })

  const cards = useMemo<CardData[]>(() => {
    if (!result) return []
    const out: CardData[] = []
    for (const f of favorites) {
      if (f.startsWith('smart:')) {
        const author = f.slice(6)
        const sc = result.smartCollections.find((s) => s.author === author)
        if (!sc) continue
        out.push({
          id: 's:' + sc.author,
          variant: 'smart',
          title: sc.author,
          subtitle: `${sc.albumCount} 卷`,
          count: sc.albumCount,
          coverPath: sc.coverImage,
          to: authorRoute(sc.author),
          isFavorite: true,
        })
        continue
      }
      const a = result.albums.find((x) => x.path === f)
      if (a) {
        out.push({
          id: 'a:' + a.path,
          variant: 'album',
          title: a.name,
          subtitle: a.author || undefined,
          count: a.imageCount,
          coverPath: a.coverImage,
          to: albumRoute(a.path),
          isFavorite: true,
        })
      }
    }
    return out
  }, [result, favorites])

  const progressPaths = useMemo(
    () => cards.filter((c) => c.variant === 'album').map((c) => {
      const m = c.to.match(/^\/albums\/(.+)$/)
      if (!m) return ''
      try {
        return decodeURIComponent(m[1])
      } catch {
        return m[1]
      }
    }).filter(Boolean),
    [cards],
  )
  const { data: progressMap } = useAllProgress(progressPaths)

  const filtered = useMemo(() => {
    const list = cards
      .filter((it) => {
        if (!query) return true
        const q = query.toLowerCase()
        return `${it.title} ${it.subtitle ?? ''}`.toLowerCase().includes(q)
      })
      .map((c) => {
        if (c.variant !== 'album') return c
        const m = c.to.match(/^\/albums\/(.+)$/)
        const k = m ? decodeURIComponent(m[1]) : ''
        const p = progressMap?.[k]
        if (!p) return c
        return { ...c, progress: { index: p.index, total: p.total } }
      })
    switch (sortBy) {
      case 'count':
        return list.sort((a, b) => b.count - a.count)
      case 'recent':
        return list.sort((a, b) => a.title.localeCompare(b.title))
      default:
        return list.sort((a, b) => a.title.localeCompare(b.title))
    }
  }, [cards, query, sortBy, progressMap])

  return (
    <div className="min-h-full">
      <section className="px-6 lg:px-10 pt-10 pb-6 max-w-[1400px]">
        <div className="flex items-center gap-2 mb-1">
          <StarIcon size={13} className="text-warning" filled />
          <span className="text-[11px] uppercase tracking-[0.14em] text-fg-muted">收藏</span>
        </div>
        <h1 className="font-display text-[32px] leading-[1.1] font-semibold tracking-tight">
          我收藏的漫画
        </h1>
        <p className="text-sm text-fg-muted mt-2 tabular-nums">
          {favorites.length} 项
        </p>
      </section>

      {favorites.length === 0 ? (
        <EmptyState
          title="还没有收藏"
          description="在主页或相册页右键点击卡片，或者使用卡片右上角的星标收藏喜欢的漫画。"
          icon={<StarIcon size={20} />}
          action={
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover text-sm"
            >
              去主页看看
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="没有匹配的收藏"
          description={query ? `没有匹配"${query}"的结果` : ''}
          action={
            <button
              onClick={() => useSearchStore.getState().reset()}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border hover:bg-bg-subtle text-sm"
            >
              清除筛选
            </button>
          }
        />
      ) : (
        <section className="max-w-[1400px]">
          <AlbumGrid items={filtered} variant={viewMode} />
        </section>
      )}
      <div className="h-12" />
    </div>
  )
}
