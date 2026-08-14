import { useEffect, useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLibraryStore } from '../store/libraryStore'
import { useSearchStore } from '../store/searchStore'
import { useScanSSE } from '../hooks/useScanSSE'
import { useFavorites } from '../hooks/useFavorites'
import { useAllProgress } from '../hooks/useReadingProgress'
import { scanApi, type ScanResult } from '../api/scan'
import AlbumGrid, { type CardData } from '../components/album/AlbumGrid'
import EmptyState from '../components/common/EmptyState'
import ScanProgress from '../components/album/ScanProgress'
import { useUIStore } from '../store/uiStore'
import { albumRoute, smartRoute } from '../utils/path'
import { PlayFilledIcon, StarIcon, ClockIcon, LibraryIcon } from '../components/common/Icon'

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
  const viewMode = useUIStore((s) => s.viewMode)
  const pushToast = useUIStore((s) => s.pushToast)

  const query = useSearchStore((s) => s.query)
  const sortBy = useSearchStore((s) => s.sortBy)
  const view = useSearchStore((s) => s.view)
  const setView = useSearchStore((s) => s.setView)

  const { favorites } = useFavorites()

  useEffect(() => {
    if (!result) loadFromBackend()
  }, [result, loadFromBackend])

  useEffect(() => {
    if (!sse.isComplete || !sse.scanId) return
    scanApi
      .result(sse.scanId)
      .then((r) => setResult(r.result))
      .catch(() => pushToast({ kind: 'error', message: '获取扫描结果失败' }))
  }, [sse.isComplete, sse.scanId, setResult, pushToast])

  const startScan = useMutation({
    mutationFn: () => scanApi.start(),
    onSuccess: (r) => {
      sse.startWith(r.scanId)
      pushToast({ kind: 'info', message: '扫描已开始' })
    },
    onError: () => pushToast({ kind: 'error', message: '启动扫描失败' }),
  })

  const cards = useMemo(() => buildCards(result), [result])

  // 继续阅读：拉取所有有进度的条目，关联到具体 albums
  const progressPaths = useMemo(
    () => cards.map((c) => (c.variant === 'album' ? decodeFromRoute(c.to) : '')).filter(Boolean),
    [cards],
  )
  const { data: progressMap } = useAllProgress(progressPaths)
  const inProgress = useMemo<CardData[]>(() => {
    if (!progressMap) return []
    const items: CardData[] = []
    for (const c of cards) {
      if (c.variant !== 'album') continue
      const k = decodeFromRoute(c.to)
      const p = progressMap[k]
      if (!p || p.index <= 0) continue
      items.push({ ...c, progress: { index: p.index, total: p.total } })
    }
    return items
      .sort((a, b) => (b.progress?.index ?? 0) - (a.progress?.index ?? 0))
      .slice(0, 6)
  }, [cards, progressMap])

  const filtered = useMemo(() => {
    const list = cards.filter((it) => {
      if (view !== 'all' && it.variant !== view) return false
      if (query) {
        const q = query.toLowerCase()
        const hay = `${it.title} ${it.subtitle ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return false || true
    })
    // 注入进度
    const withProgress = list.map((c) => {
      if (c.variant !== 'album') return c
      const k = decodeFromRoute(c.to)
      const p = progressMap?.[k]
      if (!p) return c
      return { ...c, progress: { index: p.index, total: p.total } }
    })
    switch (sortBy) {
      case 'count':
        return withProgress.sort((a, b) => b.count - a.count)
      case 'recent':
        return withProgress.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
      default:
        return withProgress.sort((a, b) => a.title.localeCompare(b.title))
    }
  }, [cards, query, sortBy, view, progressMap])

  const counts = useMemo(() => {
    const c = { all: cards.length, album: 0, collection: 0, smart: 0 }
    for (const it of cards) c[it.variant]++
    return c
  }, [cards])

  const favCount = favorites.length
  const isLoadingInitial = !result && (sse.isRunning || sse.scanId)

  return (
    <div className="min-h-full">
      <ScanProgress progress={sse.progress} onCancel={() => sse.scanId && scanApi.cancel(sse.scanId).catch(() => {})} />

      {/* 顶部 hero — 极简一行 */}
      <section className="px-6 lg:px-10 pt-10 pb-8 max-w-[1400px]">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <h1 className="font-display text-[32px] leading-[1.1] font-semibold tracking-tight">
              漫画库
            </h1>
            <p className="text-sm text-fg-muted mt-2">
              {result
                ? `${result.albumCount} 本相册 · ${result.smartCollections.length} 位作者`
                : '尚未加载漫画库'}
              {lastScanAt && (
                <span className="text-fg-subtle ml-2">
                  · 更新于 {new Date(lastScanAt).toLocaleString('zh-CN', { hour12: false })}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => startScan.mutate()}
            disabled={startScan.isPending || sse.isRunning}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors text-sm disabled:opacity-50"
          >
            {sse.isRunning ? '扫描中…' : startScan.isPending ? '启动中…' : '重新扫描'}
          </button>
        </div>

        {/* 视图切换 + 数据摘要 chips */}
        <div className="mt-7 flex items-center gap-1 flex-wrap">
          {[
            { key: 'all', label: '全部', count: counts.all, Icon: LibraryIcon },
            { key: 'album', label: '相册', count: counts.album, Icon: LibraryIcon },
            { key: 'collection', label: '集合', count: counts.collection, Icon: LibraryIcon },
            { key: 'smart', label: '作者', count: counts.smart, Icon: LibraryIcon },
          ].map((v) => {
            const active = view === v.key
            return (
              <button
                key={v.key}
                onClick={() => setView(v.key as typeof view)}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] transition-colors ${
                  active
                    ? 'bg-accent text-accent-fg'
                    : 'text-fg-muted hover:bg-bg-subtle hover:text-fg'
                }`}
              >
                <span>{v.label}</span>
                <span className={`tabular-nums text-[11px] ${active ? 'opacity-70' : 'text-fg-subtle'}`}>
                  {v.count}
                </span>
              </button>
            )
          })}
          {favCount > 0 && (
            <button
              onClick={() => setView('all')}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] text-warning/90 hover:bg-bg-subtle transition-colors ml-2"
              title="你已收藏的相册"
            >
              <StarIcon size={12} filled />
              <span>收藏</span>
              <span className="tabular-nums text-[11px] text-fg-subtle">{favCount}</span>
            </button>
          )}
        </div>
      </section>

      {/* 继续阅读 — 仅在有进度数据时显示 */}
      {inProgress.length > 0 && !query && (
        <section className="px-6 lg:px-10 pb-6 max-w-[1400px]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PlayFilledIcon size={12} className="text-fg-muted" />
              <h2 className="text-[11px] uppercase tracking-[0.14em] text-fg-muted font-medium">
                继续阅读
              </h2>
              <span className="text-[11px] text-fg-subtle tabular-nums">{inProgress.length}</span>
            </div>
          </div>
          <AlbumGrid items={inProgress} variant={viewMode} />
        </section>
      )}

      {/* 全部 / 筛选结果 */}
      <section className="max-w-[1400px]">
        {inProgress.length > 0 && !query && (
          <div className="px-6 lg:px-10 pt-2 pb-3 flex items-center gap-2">
            <LibraryIcon size={12} className="text-fg-muted" />
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-fg-muted font-medium">
              全部漫画
            </h2>
            <span className="text-[11px] text-fg-subtle tabular-nums">{filtered.length}</span>
          </div>
        )}

        {isLoadingInitial ? (
          <EmptyState
            title="正在加载漫画库"
            description="首次启动可能需要几秒钟。"
            icon={
              <div className="w-10 h-10 border-2 border-fg-subtle border-t-accent rounded-full animate-spin" />
            }
          />
        ) : !result ? (
          <EmptyState
            title="欢迎使用 Manga"
            description="点击下方按钮开始扫描你的漫画目录。"
            icon={<LibraryIcon size={20} />}
            action={
              <button
                onClick={() => startScan.mutate()}
                disabled={startScan.isPending}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover text-sm disabled:opacity-50"
              >
                {startScan.isPending ? '启动中…' : '开始扫描'}
              </button>
            }
          />
        ) : cards.length === 0 ? (
          <EmptyState
            title="暂无漫画"
            description="未在配置目录下找到图片文件。检查 COMIC_ROOT 路径是否正确。"
            icon={<LibraryIcon size={20} />}
            action={
              <button
                onClick={() => startScan.mutate()}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover text-sm"
              >
                重新扫描
              </button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="没有匹配的漫画"
            description={query ? `没有匹配"${query}"的结果` : '当前视图下没有内容'}
            icon={<ClockIcon size={20} />}
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
          <AlbumGrid items={filtered} variant={viewMode} />
        )}
      </section>

      <div className="h-12" />
    </div>
  )
}

function decodeFromRoute(to: string): string {
  if (!to.startsWith('/albums/')) return ''
  try {
    return decodeURIComponent(to.replace(/^\/albums\//, ''))
  } catch {
    return to.replace(/^\/albums\//, '')
  }
}
