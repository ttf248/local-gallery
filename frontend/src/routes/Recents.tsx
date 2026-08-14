import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibraryStore } from '../store/libraryStore'
import { useSearchStore } from '../store/searchStore'
import { useUIStore } from '../store/uiStore'
import { useQuery } from '@tanstack/react-query'
import { historyApi } from '../api/prefs'
import { useAllProgress } from '../hooks/useReadingProgress'
import AlbumGrid, { type CardData } from '../components/album/AlbumGrid'
import EmptyState from '../components/common/EmptyState'
import { ClockIcon } from '../components/common/Icon'
import { albumRoute } from '../utils/path'

// 最近访问：从后端 history 列表中读取。带阅读进度。
export default function Recents() {
  const navigate = useNavigate()
  const result = useLibraryStore((s) => s.result)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)
  const viewMode = useUIStore((s) => s.viewMode)
  const query = useSearchStore((s) => s.query)
  const sortBy = useSearchStore((s) => s.sortBy)

  useEffect(() => {
    if (!result) loadFromBackend()
  }, [result, loadFromBackend])

  const { data } = useQuery({
    queryKey: ['history'],
    queryFn: () => historyApi.list(),
    staleTime: 30 * 1000,
  })

  const cards = useMemo<CardData[]>(() => {
    const items = data?.history ?? []
    if (!result) return []
    const out: CardData[] = []
    for (const h of items) {
      const a = result.albums.find((x) => x.path === h.path)
      if (!a) continue
      out.push({
        id: 'a:' + a.path,
        variant: 'album',
        title: a.name,
        subtitle: a.author || undefined,
        count: a.imageCount,
        coverPath: a.coverImage,
        to: albumRoute(a.path),
      })
    }
    return out
  }, [data, result])

  const progressPaths = useMemo(() => cards.map((c) => {
    const m = c.to.match(/^\/albums\/(.+)$/)
    if (!m) return ''
    try { return decodeURIComponent(m[1]) } catch { return m[1] }
  }), [cards])
  const { data: progressMap } = useAllProgress(progressPaths)

  const filtered = useMemo(() => {
    const list = cards
      .filter((it) => {
        if (!query) return true
        const q = query.toLowerCase()
        return `${it.title} ${it.subtitle ?? ''}`.toLowerCase().includes(q)
      })
      .map((c) => {
        const m = c.to.match(/^\/albums\/(.+)$/)
        const k = m ? decodeURIComponent(m[1]) : ''
        const p = progressMap?.[k]
        if (!p) return c
        return { ...c, progress: { index: p.index, total: p.total } }
      })
    switch (sortBy) {
      case 'count':
        return list.sort((a, b) => b.count - a.count)
      default:
        // recent：保持原顺序
        return list
    }
  }, [cards, query, sortBy, progressMap])

  return (
    <div className="min-h-full">
      <section className="px-6 lg:px-10 pt-10 pb-6 max-w-[1400px]">
        <div className="flex items-center gap-2 mb-1">
          <ClockIcon size={13} className="text-fg-muted" />
          <span className="text-[11px] uppercase tracking-[0.14em] text-fg-muted">最近</span>
        </div>
        <h1 className="font-display text-[32px] leading-[1.1] font-semibold tracking-tight">
          最近阅读
        </h1>
        <p className="text-sm text-fg-muted mt-2 tabular-nums">
          {cards.length} 本
        </p>
      </section>

      {cards.length === 0 ? (
        <EmptyState
          title="还没有最近阅读"
          description="打开任意一本漫画开始阅读，它会出现在这里。"
          icon={<ClockIcon size={20} />}
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
          title="没有匹配的最近访问"
          description={query ? `没有匹配"${query}"的结果` : ''}
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
