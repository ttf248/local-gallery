import { useEffect, useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
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
import { albumRoute, tagRoute, decodeFavPath } from '../utils/path'
import {
  PlayFilledIcon,
  StarIcon,
  LibraryIcon,
  ShuffleIcon,
  ClockIcon,
  RefreshIcon,
  RewindIcon,
  SparklesIcon,
} from '../components/common/Icon'

// 「重温」智能合集阈值：超过 N 天没看就推荐。
const REWIND_DAYS = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

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
      to: tagRoute(s.author),
    })
  }
  return items
}

export default function Home() {
  const navigate = useNavigate()
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

  const onShuffle = () => {
    if (!result || result.albums.length === 0) {
      pushToast({ kind: 'info', message: '尚未加载图像库' })
      return
    }
    const idx = Math.floor(Math.random() * result.albums.length)
    const a = result.albums[idx]
    navigate(albumRoute(a.path))
  }

  const cards = useMemo(() => buildCards(result), [result])

  // 继续阅读：拉取所有有进度的条目，关联到具体 albums
  const progressPaths = useMemo(
    () =>
      cards
        .map((c) => (c.variant === 'album' ? decodeFavPath(c.to) : ''))
        .filter(Boolean),
    [cards],
  )
  const { data: progressMap } = useAllProgress(progressPaths)
  const inProgress = useMemo<CardData[]>(() => {
    if (!progressMap) return []
    const items: CardData[] = []
    for (const c of cards) {
      if (c.variant !== 'album') continue
      const k = decodeFavPath(c.to)
      const p = progressMap[k]
      if (!p || p.index <= 0) continue
      items.push({ ...c, progress: { index: p.index, total: p.total } })
    }
    return items
      .sort((a, b) => (b.progress?.index ?? 0) - (a.progress?.index ?? 0))
      .slice(0, 8)
  }, [cards, progressMap])

  // 最近加入：按 modTime 倒序
  const recentAdded = useMemo<CardData[]>(() => {
    if (!result) return []
    return [...result.albums]
      .filter((a) => a.modTime)
      .sort((a, b) => +new Date(b.modTime ?? '') - +new Date(a.modTime ?? ''))
      .slice(0, 8)
      .map((a) => ({
        id: 'a:' + a.path,
        variant: 'album' as const,
        title: a.name,
        subtitle: a.author || undefined,
        count: a.imageCount,
        coverPath: a.coverImage,
        to: albumRoute(a.path),
      }))
  }, [result])

  // 热门标签：合集内文件夹数最多
  const topAuthors = useMemo<CardData[]>(() => {
    if (!result) return []
    return [...result.smartCollections]
      .sort((a, b) => b.albumCount - a.albumCount)
      .slice(0, 8)
      .map((s) => ({
        id: 's:' + s.author,
        variant: 'smart' as const,
        title: s.author,
        subtitle: `${s.albumCount} 卷`,
        count: s.albumCount,
        coverPath: s.coverImage,
        to: tagRoute(s.author),
      }))
  }, [result])

  // 「重温」：上次阅读（或入库时间）距今 > REWIND_DAYS 天的相册。
  //   - 有进度：按 progress.updated 判断
  //   - 无进度：按 album.modTime 判断（库里的"老新人"）
  //   排序：最久没看的在前
  const rewind = useMemo<CardData[]>(() => {
    if (!result) return []
    const now = Date.now()
    const threshold = now - REWIND_DAYS * MS_PER_DAY
    const items: { card: CardData; since: number }[] = []
    for (const a of result.albums) {
      const p = progressMap?.[a.path]
      const lastTs = p?.updated ? +new Date(p.updated) : a.modTime ? +new Date(a.modTime) : 0
      if (!lastTs || lastTs > threshold) continue
      items.push({
        card: {
          id: 'a:' + a.path,
          variant: 'album',
          title: a.name,
          subtitle: a.author || undefined,
          count: a.imageCount,
          coverPath: a.coverImage,
          to: albumRoute(a.path),
          progress: p ? { index: p.index, total: p.total } : undefined,
          lastSeenAt: p?.updated ?? null,
          badge: 'rewind',
        },
        since: lastTs,
      })
    }
    return items.sort((a, b) => a.since - b.since).slice(0, 8).map((it) => it.card)
  }, [result, progressMap])

  // 「全新」：从未打开过、且 modTime 在 REWIND 阈值之前的相册。
  //   - 没进度记录 = 没看过
  //   - 没 modTime = 老文件，不一定"新"，优先不推
  //   排序：按 modTime 倒序（最新加入在前）
  const fresh = useMemo<CardData[]>(() => {
    if (!result) return []
    const modTimeOf = (path: string) =>
      +new Date(result.albums.find((x) => x.path === path)?.modTime ?? '')
    const items: CardData[] = []
    for (const a of result.albums) {
      if (!a.modTime) continue
      if (progressMap?.[a.path]) continue // 已有进度，不算"全新"
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
    return items.sort((a, b) => modTimeOf(decodeFavPath(b.to)) - modTimeOf(decodeFavPath(a.to))).slice(0, 8)
  }, [result, progressMap])

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
    const withProgress = list.map((c) => {
      if (c.variant !== 'album') return c
      const k = decodeFavPath(c.to)
      const p = progressMap?.[k]
      if (!p) return c
      return { ...c, progress: { index: p.index, total: p.total } }
    })
    switch (sortBy) {
      case 'count':
        return withProgress.sort((a, b) => b.count - a.count)
      case 'recent':
        return withProgress.sort(
          (a, b) => +new Date(recentTime(result, b.id)) - +new Date(recentTime(result, a.id)),
        )
      default:
        return withProgress.sort((a, b) => a.title.localeCompare(b.title))
    }
  }, [cards, query, sortBy, view, progressMap, result])

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

      {/* 顶部 hero — 极简大字 + 关键动作 */}
      <section className="px-6 lg:px-10 pt-12 pb-8 max-w-[1400px] mx-auto w-full">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-fg-subtle font-medium">
              库 · Library
            </div>
            <h1 className="font-display text-[40px] leading-[1.05] font-semibold tracking-[-0.02em] mt-2">
              图像库
            </h1>
            <p className="text-sm text-fg-muted mt-3">
              {result
                ? `${result.albumCount} 个文件夹 · ${result.smartCollections.length} 个合集`
                : '尚未加载图像库'}
              {lastScanAt && (
                <span className="text-fg-subtle ml-2">
                  · 更新于 {new Date(lastScanAt).toLocaleString('zh-CN', { hour12: false })}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onShuffle}
              disabled={!result || result.albums.length === 0}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md border border-border hover:bg-bg-subtle text-sm transition-colors disabled:opacity-40"
              title="随机挑一本 (R)"
            >
              <ShuffleIcon size={13} />
              <span>随机一本</span>
            </button>
            <button
              onClick={() => startScan.mutate()}
              disabled={startScan.isPending || sse.isRunning}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover transition-colors text-sm disabled:opacity-50"
            >
              <RefreshIcon size={12} />
              <span>
                {sse.isRunning ? '扫描中…' : startScan.isPending ? '启动中…' : '重新扫描'}
              </span>
            </button>
          </div>
        </div>

        {/* 视图切换 + 数据摘要 chips */}
        <div className="mt-8 flex items-center gap-1 flex-wrap">
          {[
            { key: 'all', label: '全部', count: counts.all },
            { key: 'album', label: '文件夹', count: counts.album },
            { key: 'collection', label: '集合', count: counts.collection },
            { key: 'smart', label: '标签', count: counts.smart },
          ].map((v) => {
            const active = view === v.key
            return (
              <button
                key={v.key}
                onClick={() => setView(v.key as typeof view)}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] transition-colors ${
                  active
                    ? 'bg-accent text-accent-contrast'
                    : 'text-fg-muted hover:bg-bg-subtle hover:text-fg'
                }`}
              >
                <span>{v.label}</span>
                <span
                  className={`tabular-nums text-[11px] ${active ? 'opacity-70' : 'text-fg-subtle'}`}
                >
                  {v.count}
                </span>
              </button>
            )
          })}
          {favCount > 0 && (
            <button
              onClick={() => navigate('/favorites')}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] text-warning/90 hover:bg-bg-subtle transition-colors ml-2"
              title="你已收藏的文件夹"
            >
              <StarIcon size={12} filled />
              <span>收藏</span>
              <span className="tabular-nums text-[11px] text-fg-subtle">{favCount}</span>
            </button>
          )}
        </div>
      </section>

      {/* 继续阅读 */}
      {inProgress.length > 0 && !query && (
        <SectionBlock
          title="继续阅读"
          icon={<PlayFilledIcon size={11} className="text-fg-muted" />}
          count={inProgress.length}
        >
          <AlbumGrid items={inProgress} variant={viewMode} />
        </SectionBlock>
      )}

      {/* 全新：从未打开的相册 */}
      {fresh.length > 0 && !query && (
        <SectionBlock
          title="全新"
          subtitle="还没看过"
          icon={<SparklesIcon size={11} className="text-fg-muted" />}
          count={fresh.length}
        >
          <AlbumGrid items={fresh} variant={viewMode} />
        </SectionBlock>
      )}

      {/* 重温：> 30 天没看的相册 */}
      {rewind.length > 0 && !query && (
        <SectionBlock
          title="重温"
          subtitle={`${REWIND_DAYS}+ 天没看`}
          icon={<RewindIcon size={11} className="text-fg-muted" />}
          count={rewind.length}
        >
          <AlbumGrid items={rewind} variant={viewMode} />
        </SectionBlock>
      )}

      {/* 最近加入 */}
      {recentAdded.length > 0 && !query && (
        <SectionBlock
          title="最近加入"
          icon={<ClockIcon size={11} className="text-fg-muted" />}
          count={recentAdded.length}
        >
          <AlbumGrid items={recentAdded} variant={viewMode} />
        </SectionBlock>
      )}

      {/* 热门标签 */}
      {topAuthors.length > 0 && !query && view === 'all' && (
        <SectionBlock
          title="热门标签"
          icon={<StarIcon size={11} className="text-fg-muted" filled />}
          count={topAuthors.length}
        >
          <AlbumGrid items={topAuthors} variant={viewMode} />
        </SectionBlock>
      )}

      {/* 全部 / 筛选结果 */}
      <section className="max-w-[1400px] mx-auto w-full">
        {(inProgress.length > 0 ||
          fresh.length > 0 ||
          rewind.length > 0 ||
          recentAdded.length > 0 ||
          topAuthors.length > 0) &&
          !query && (
            <div className="px-6 lg:px-10 pt-2 pb-3 flex items-center gap-2">
              <LibraryIcon size={12} className="text-fg-muted" />
              <h2 className="text-[11px] uppercase tracking-[0.18em] text-fg-muted font-medium">
                全部图像
              </h2>
              <span className="text-[11px] text-fg-subtle tabular-nums">{filtered.length}</span>
            </div>
          )}

        {isLoadingInitial ? (
          <EmptyState
            title="正在加载图像库"
            description="首次启动可能需要几秒钟。"
            icon={
              <div className="w-10 h-10 border-2 border-fg-subtle border-t-accent rounded-full animate-spin" />
            }
          />
        ) : !result ? (
          <EmptyState
            title="欢迎使用图像浏览器"
            description="点击下方按钮开始扫描你的本地图像目录。"
            icon={<LibraryIcon size={20} />}
            action={
              <button
                onClick={() => startScan.mutate()}
                disabled={startScan.isPending}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover text-sm disabled:opacity-50"
              >
                {startScan.isPending ? '启动中…' : '开始扫描'}
              </button>
            }
          />
        ) : cards.length === 0 ? (
          <EmptyState
            title="暂无图像"
            description="未在配置目录下找到图像文件。检查 mediaRoot 路径是否正确。"
            icon={<LibraryIcon size={20} />}
            action={
              <button
                onClick={() => startScan.mutate()}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover text-sm"
              >
                重新扫描
              </button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="没有匹配的图像"
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

function recentTime(result: ScanResult | null, id: string): string {
  if (!result) return ''
  if (id.startsWith('a:')) {
    const p = id.slice(2)
    return result.albums.find((a) => a.path === p)?.modTime ?? ''
  }
  if (id.startsWith('c:')) {
    const p = id.slice(2)
    return result.collections.find((c) => c.path === p)?.albums?.[0]?.modTime ?? ''
  }
  if (id.startsWith('s:')) {
    const author = id.slice(2)
    const sc = result.smartCollections.find((s) => s.author === author)
    if (sc) {
      const newest = [...sc.albums].sort(
        (a, b) => +new Date(b.modTime ?? '') - +new Date(a.modTime ?? ''),
      )[0]
      return newest?.modTime ?? ''
    }
  }
  return ''
}

function SectionBlock({
  title,
  subtitle,
  icon,
  count,
  children,
}: {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  count: number
  children: React.ReactNode
}) {
  return (
    <section className="px-6 lg:px-10 pb-6 max-w-[1400px] mx-auto w-full">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-fg-muted font-medium">
          {title}
        </h2>
        {subtitle && (
          <span className="text-[11px] text-fg-subtle normal-case tracking-normal">
            {subtitle}
          </span>
        )}
        <span className="text-[11px] text-fg-subtle tabular-nums">{count}</span>
      </div>
      {children}
    </section>
  )
}
