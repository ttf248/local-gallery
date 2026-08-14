import { useEffect, useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLibraryStore } from '../store/libraryStore'
import { useSearchStore } from '../store/searchStore'
import { useScanSSE } from '../hooks/useScanSSE'
import { scanApi, type ScanResult } from '../api/scan'
import AlbumGrid, { type CardData } from '../components/album/AlbumGrid'
import EmptyState from '../components/common/EmptyState'
import ScanProgress from '../components/album/ScanProgress'
import { albumRoute, smartRoute } from '../utils/path'

function buildCards(r: ScanResult | null): CardData[] {
  if (!r) return []
  const items: CardData[] = []
  for (const a of r.albums) {
    items.push({
      id: 'a:' + a.path,
      variant: 'album',
      title: a.name,
      subtitle: a.author || undefined,
      count: a.imageCount,
      coverPath: a.coverImage,
      to: albumRoute(a.path),
    })
  }
  for (const c of r.collections) {
    items.push({
      id: 'c:' + c.path,
      variant: 'collection',
      title: c.name,
      subtitle: '集合',
      count: c.albumCount,
      coverPath: c.albums[0]?.coverImage ?? '',
      to: albumRoute(c.path),
    })
  }
  for (const s of r.smartCollections) {
    items.push({
      id: 's:' + s.author,
      variant: 'smart',
      title: s.author,
      subtitle: `${s.albumCount} 卷`,
      count: s.albumCount,
      coverPath: s.coverImage,
      to: smartRoute(s.author),
    })
  }
  return items
}

export default function Home() {
  const result = useLibraryStore((s) => s.result)
  const setResult = useLibraryStore((s) => s.setResult)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)
  const lastScanAt = useLibraryStore((s) => s.lastScanAt)
  const sse = useScanSSE()

  const query = useSearchStore((s) => s.query)
  const sortBy = useSearchStore((s) => s.sortBy)
  const view = useSearchStore((s) => s.view)
  const setView = useSearchStore((s) => s.setView)

  // 初次加载：从后端拉一次扫描缓存（避免每次手动扫描）
  useEffect(() => {
    if (!result) loadFromBackend()
  }, [result, loadFromBackend])

  // 扫描完成后写入 store
  useEffect(() => {
    if (!sse.isComplete || !sse.scanId) return
    scanApi
      .result(sse.scanId)
      .then((r) => setResult(r.result))
      .catch(() => {})
  }, [sse.isComplete, sse.scanId, setResult])

  // 自动滚动到顶部
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  const startScan = useMutation({
    mutationFn: () => scanApi.start(),
    onSuccess: (r) => {
      sse.startWith(r.scanId)
    },
  })

  const cards = useMemo(() => buildCards(result), [result])

  // 应用视图 / 搜索 / 排序
  const filtered = useMemo(() => {
    const list = cards.filter((it) => {
      if (view !== 'all' && it.variant !== view) return false
      if (query) {
        const q = query.toLowerCase()
        const hay = `${it.title} ${it.subtitle ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    switch (sortBy) {
      case 'count':
        return list.sort((a, b) => b.count - a.count)
      case 'recent':
        return list.sort((a, b) => a.title.localeCompare(b.title))
      default:
        return list.sort((a, b) => a.title.localeCompare(b.title))
    }
  }, [cards, query, sortBy, view])

  const counts = useMemo(() => {
    const c = { all: cards.length, album: 0, collection: 0, smart: 0 }
    for (const it of cards) c[it.variant]++
    return c
  }, [cards])

  return (
    <>
      <ScanProgress progress={sse.progress} />

      <section className="px-6 lg:px-10 pt-8 pb-4 border-b border-border bg-bg-elevated/40">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">漫画库</h1>
            <p className="text-sm text-fg-muted mt-1">
              {result
                ? `${result.albumCount} 本相册 · ${result.smartCollections.length} 个作者集合`
                : '尚未加载漫画库'}
              {lastScanAt && (
                <span className="text-fg-subtle ml-3">
                  · 上次扫描 {new Date(lastScanAt).toLocaleString()}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => startScan.mutate()}
            disabled={startScan.isPending || sse.isRunning}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors text-sm disabled:opacity-50"
          >
            {sse.isRunning ? '扫描中…' : startScan.isPending ? '启动中…' : '重新扫描'}
          </button>
        </div>

        {/* 视图切换 */}
        <div className="mt-6 flex items-center gap-1 flex-wrap">
          {[
            { key: 'all', label: '全部', count: counts.all },
            { key: 'album', label: '相册', count: counts.album },
            { key: 'collection', label: '集合', count: counts.collection },
            { key: 'smart', label: '作者', count: counts.smart },
          ].map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key as typeof view)}
              className={`px-3 py-1 rounded-full text-sm transition-colors ${
                view === v.key
                  ? 'bg-accent text-accent-fg'
                  : 'text-fg-muted hover:bg-bg-subtle hover:text-fg'
              }`}
            >
              {v.label}
              <span className="ml-1.5 tabular-nums opacity-60">{v.count}</span>
            </button>
          ))}
        </div>
      </section>

      {result && cards.length === 0 ? (
        <EmptyState
          title="暂无漫画"
          description="点击右上角「重新扫描」加载漫画根目录。"
          action={
            <button
              onClick={() => startScan.mutate()}
              className="px-4 py-2 rounded-md bg-accent text-accent-fg hover:bg-accent-hover text-sm"
            >
              重新扫描
            </button>
          }
        />
      ) : !result && !sse.isRunning ? (
        <EmptyState
          title="欢迎使用漫画阅读器"
          description="点击下方按钮加载所有漫画。"
          action={
            <button
              onClick={() => startScan.mutate()}
              disabled={startScan.isPending}
              className="px-4 py-2 rounded-md bg-accent text-accent-fg hover:bg-accent-hover text-sm disabled:opacity-50"
            >
              {startScan.isPending ? '启动中…' : '开始扫描'}
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="没有匹配的漫画"
          description={query ? `没有匹配"${query}"的结果` : '当前视图下没有内容'}
          action={
            <button
              onClick={() => useSearchStore.getState().reset()}
              className="px-4 py-2 rounded-md border border-border hover:bg-bg-subtle text-sm"
            >
              清除筛选
            </button>
          }
        />
      ) : (
        <AlbumGrid items={filtered} />
      )}
    </>
  )
}
