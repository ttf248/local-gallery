import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { historyApi } from '../api/prefs'
import { useLibraryStore } from '../store/libraryStore'
import { useSearchStore } from '../store/searchStore'
import AlbumGrid, { type CardData } from '../components/album/AlbumGrid'
import EmptyState from '../components/common/EmptyState'
import { albumRoute } from '../utils/path'

export default function Recents() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['history'],
    queryFn: () => historyApi.list(),
  })
  const result = useLibraryStore((s) => s.result)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)
  const query = useSearchStore((s) => s.query)
  const sortBy = useSearchStore((s) => s.sortBy)

  if (!result) loadFromBackend()

  const clear = useMutation({
    mutationFn: () => historyApi.clear(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['history'] }),
  })

  const history = data?.history ?? []

  const cards = useMemo<CardData[]>(() => {
    if (!result || history.length === 0) return []
    const items: CardData[] = []
    const seen = new Set<string>()
    for (const h of history) {
      if (seen.has(h.path)) continue
      seen.add(h.path)
      if (h.path.startsWith('smart:')) {
        const author = h.path.slice(6)
        const sc = result.smartCollections.find((s) => s.author === author)
        if (sc) {
          items.push({
            id: 's:' + author,
            variant: 'smart',
            title: sc.author,
            subtitle: `${sc.albumCount} 卷`,
            count: sc.albumCount,
            coverPath: sc.coverImage,
            to: `/albums/${encodeURIComponent(h.path)}`,
          })
        }
      } else {
        const album = result.albums.find((a) => a.path === h.path)
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
    // recents 默认按最近打开排序，不应用 sortBy；其他视图再走 sortBy
    if (sortBy === 'name') return filtered.sort((a, b) => a.title.localeCompare(b.title))
    if (sortBy === 'count') return filtered.sort((a, b) => b.count - a.count)
    return filtered
  }, [result, history, query, sortBy])

  if (isLoading) return <div className="p-6 text-fg-muted">加载中…</div>

  return (
    <>
      <section className="px-6 lg:px-10 pt-8 pb-4 border-b border-border bg-bg-elevated/40 flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">最近</h1>
          <p className="text-sm text-fg-muted mt-1">{cards.length} 项</p>
        </div>
        {history.length > 0 && (
          <button
            onClick={() => clear.mutate()}
            className="text-xs text-fg-muted hover:text-fg"
          >
            清空
          </button>
        )}
      </section>
      {history.length === 0 ? (
        <EmptyState
          title="暂无最近访问"
          description="打开任意一本漫画后会自动出现在这里。"
        />
      ) : cards.length === 0 ? (
        <EmptyState
          title="记录已失效"
          description="扫描缓存中没有对应的相册，请重新扫描后再试。"
        />
      ) : (
        <AlbumGrid items={cards} />
      )}
    </>
  )
}
