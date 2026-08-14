import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { favoritesApi } from '../api/prefs'
import { useLibraryStore } from '../store/libraryStore'
import { useSearchStore } from '../store/searchStore'
import AlbumGrid, { type CardData } from '../components/album/AlbumGrid'
import EmptyState from '../components/common/EmptyState'
import { albumRoute } from '../utils/path'

export default function Favorites() {
  const { data, isLoading } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => favoritesApi.list(),
  })
  const result = useLibraryStore((s) => s.result)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)
  const query = useSearchStore((s) => s.query)
  const sortBy = useSearchStore((s) => s.sortBy)

  // 首次进入拉一次扫描缓存
  if (!result) loadFromBackend()

  const favs = data?.favorites ?? []

  // 把收藏 path 映射成 CardData：album → 实际相册；smart:<author> → 智能集合
  const cards = useMemo<CardData[]>(() => {
    if (!result) return []
    const items: CardData[] = []
    const seen = new Set<string>()
    for (const p of favs) {
      if (seen.has(p)) continue
      seen.add(p)
      if (p.startsWith('smart:')) {
        const author = p.slice(6)
        const sc = result.smartCollections.find((s) => s.author === author)
        if (sc) {
          items.push({
            id: 's:' + author,
            variant: 'smart',
            title: sc.author,
            subtitle: `${sc.albumCount} 卷`,
            count: sc.albumCount,
            coverPath: sc.coverImage,
            to: `/albums/${encodeURIComponent(p)}`,
          })
        }
      } else {
        const album = result.albums.find((a) => a.path === p)
        if (album) {
          items.push({
            id: 'a:' + album.path,
            variant: 'album',
            title: album.name,
            subtitle: album.author,
            count: album.imageCount,
            coverPath: album.coverImage,
            to: albumRoute(album.path),
          })
        }
      }
    }
    const filtered = items.filter(
      (it) =>
        !query ||
        `${it.title} ${it.subtitle ?? ''}`.toLowerCase().includes(query.toLowerCase()),
    )
    switch (sortBy) {
      case 'count':
        return filtered.sort((a, b) => b.count - a.count)
      default:
        return filtered.sort((a, b) => a.title.localeCompare(b.title))
    }
  }, [result, favs, query, sortBy])

  if (isLoading) {
    return <div className="p-6 text-fg-muted">加载中…</div>
  }

  return (
    <>
      <section className="px-6 lg:px-10 pt-8 pb-4 border-b border-border bg-bg-elevated/40">
        <h1 className="font-display text-3xl font-semibold tracking-tight">收藏</h1>
        <p className="text-sm text-fg-muted mt-1">
          {cards.length} 项 · 在右键菜单中可以快速收藏 / 取消收藏
        </p>
      </section>
      {favs.length === 0 ? (
        <EmptyState
          title="暂无收藏"
          description="在漫画卡片上点击右键可以添加收藏。"
        />
      ) : cards.length === 0 ? (
        <EmptyState
          title="收藏已失效"
          description="扫描缓存中没有对应的相册，请重新扫描后再试。"
        />
      ) : (
        <AlbumGrid items={cards} />
      )}
    </>
  )
}
