import { useEffect, useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useLibraryStore } from '../store/libraryStore'
import { useSearchStore } from '../store/searchStore'
import { useScanSSE } from '../hooks/useScanSSE'
import { useFavorites } from '../hooks/useFavorites'
import { useAllProgress } from '../hooks/useReadingProgress'
import { useViewerContextSync } from '../hooks/useViewerContextSync'
import { scanApi, type ScanResult } from '../api/scan'
import AlbumGrid, { type CardData } from '../components/album/AlbumGrid'
import { ListFilterBar } from '../components/common/ListFilterBar'
import EmptyState from '../components/common/EmptyState'
import ScanProgress from '../components/album/ScanProgress'
import { useUIStore } from '../store/uiStore'
import { albumRoute, tagRoute, decodeFavPath } from '../utils/path'
import type { ViewerContextEntry } from '../utils/viewerContext'
import {
  PlayFilledIcon,
  StarIcon,
  ShuffleIcon,
  RefreshIcon,
  SparklesIcon,
  RewindIcon,
  ClockIcon,
  LibraryIcon,
} from '../components/common/Icon'
import AlbumCard from '../components/album/AlbumCard'

// 「重温」智能合集阈值：超过 N 天没看就推荐。
const REWIND_DAYS = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

function buildCards(r: ScanResult | null): CardData[] {
  if (!r) return []
  const collections = r.collections ?? []
  const smartCollections = r.smartCollections ?? []
  const items: CardData[] = []
  for (const a of r.albums) {
    items.push({
      id: 'a:' + a.path,
      variant: 'album',
      title: a.name,
      displayTitle: a.displayName,
      subtitle: a.author || undefined,
      count: a.imageCount,
      coverPath: a.coverImage,
      to: albumRoute(a.path),
      sourceRoot: a.sourceRoot,
      sourceName: a.sourceName,
    })
  }
  for (const c of collections) {
    items.push({
      id: 'c:' + c.path,
      variant: 'collection',
      title: c.name,
      displayTitle: c.displayName,
      subtitle: '集合',
      count: c.albumCount,
      coverPath: c.albums[0]?.coverImage ?? '',
      to: albumRoute(c.path),
      sourceRoot: c.sourceRoot,
      sourceName: c.sourceName,
    })
  }
  for (const s of smartCollections) {
    items.push({
      id: 's:' + s.author,
      variant: 'smart',
      title: s.author,
      // 不要 subtitle:count 已经显示「X 卷」,subtitle 写「X 卷」就重复了
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
  const pushToast = useUIStore((s) => s.pushToast)

  const query = useSearchStore((s) => s.query)
  const sortBy = useSearchStore((s) => s.sortBy)
  const view = useSearchStore((s) => s.view)
  const setView = useSearchStore((s) => s.setView)
  const viewMode = useUIStore((s) => s.viewMode)

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

  // 继续阅读
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
      .slice(0, 4)
  }, [cards, progressMap])

  // 最近加入
  const recentAdded = useMemo<CardData[]>(() => {
    if (!result) return []
    return [...result.albums]
      .filter((a) => a.modTime)
      .sort((a, b) => +new Date(b.modTime ?? '') - +new Date(a.modTime ?? ''))
      .slice(0, 4)
      .map((a) => ({
        id: 'a:' + a.path,
        variant: 'album' as const,
        title: a.name,
        displayTitle: a.displayName,
        subtitle: a.author || undefined,
        count: a.imageCount,
        coverPath: a.coverImage,
        to: albumRoute(a.path),
        sourceRoot: a.sourceRoot,
        sourceName: a.sourceName,
      }))
  }, [result])

  // 全新：未看过
  const fresh = useMemo<CardData[]>(() => {
    if (!result) return []
    const modTimeOf = (path: string) =>
      +new Date(result.albums.find((x) => x.path === path)?.modTime ?? '')
    const items: CardData[] = []
    for (const a of result.albums) {
      if (!a.modTime) continue
      if (progressMap?.[a.path]) continue
      items.push({
        id: 'a:' + a.path,
        variant: 'album' as const,
        title: a.name,
        displayTitle: a.displayName,
        subtitle: a.author || undefined,
        count: a.imageCount,
        coverPath: a.coverImage,
        to: albumRoute(a.path),
        sourceRoot: a.sourceRoot,
        sourceName: a.sourceName,
      })
    }
    return items
      .sort((a, b) => modTimeOf(decodeFavPath(b.to)) - modTimeOf(decodeFavPath(a.to)))
      .slice(0, 4)
  }, [result, progressMap])

  // 重温：30+ 天没看
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
          variant: 'album' as const,
          title: a.name,
          displayTitle: a.displayName,
          subtitle: a.author || undefined,
          count: a.imageCount,
          coverPath: a.coverImage,
          to: albumRoute(a.path),
          sourceRoot: a.sourceRoot,
          sourceName: a.sourceName,
          progress: p ? { index: p.index, total: p.total } : undefined,
          lastSeenAt: p?.updated ?? null,
          badge: 'rewind' as const,
        },
        since: lastTs,
      })
    }
    return items.sort((a, b) => a.since - b.since).slice(0, 4).map((it) => it.card)
  }, [result, progressMap])

  // 热门标签
  const topTags = useMemo<CardData[]>(() => {
    if (!result) return []
    return [...(result.smartCollections ?? [])]
      .sort((a, b) => b.albumCount - a.albumCount)
      .slice(0, 4)
      .map((s) => ({
        id: 's:' + s.author,
        variant: 'smart' as const,
        title: s.author,
        // 副标题空:count 已经显示「X 卷」,再写一遍就「5 卷 · 5 卷」了
        count: s.albumCount,
        coverPath: s.coverImage,
        to: tagRoute(s.author),
      }))
  }, [result])

  // 全部图像 filter
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

  const homeEntries = useMemo<ViewerContextEntry[]>(
    () =>
      filtered
        .filter((c) => c.variant === 'album')
        .map((c) => ({ key: decodeFavPath(c.to), to: c.to, name: c.title })),
    [filtered],
  )
  useViewerContextSync({ type: 'home' }, homeEntries)

  const counts = useMemo(() => {
    const c = { all: cards.length, album: 0, collection: 0, smart: 0 }
    for (const it of cards) c[it.variant]++
    return c
  }, [cards])

  const favCount = favorites.length
  const isLoadingInitial = !result && (sse.isRunning || sse.scanId)
  const hasContent = !!result && cards.length > 0

  // 决定主 CTA
  const primaryAlbum = inProgress[0]
  const primaryAction = primaryAlbum
    ? { kind: 'continue' as const, card: primaryAlbum }
    : null
  const scanLabel = sse.isRunning
    ? '扫描中…'
    : startScan.isPending
      ? '启动中…'
      : '重新扫描'

  // 「继续上次」直跳查看器：进首页最大的目的是「接着看」，
  // 中转 Album 详情会多一次点击，对随手翻翻的场景不友好。
  // 用户想看 album 信息的话，从卡片点进去同样可达。
  const onContinue = (card: CardData) => {
    if (card.variant !== 'album') {
      navigate(card.to)
      return
    }
    const idx = card.progress?.index ?? 0
    const qs = new URLSearchParams({
      path: decodeFavPath(card.to),
      index: String(idx),
      name: card.title,
    })
    navigate(`/viewer?${qs.toString()}`)
  }

  return (
    <div className="min-h-full">
      <ScanProgress
        progress={sse.progress}
        onCancel={() => sse.scanId && scanApi.cancel(sse.scanId).catch(() => {})}
      />

      {/* Hero — 一个明确主入口 + 极简次动作 */}
      <section className="px-6 lg:px-10 pt-14 pb-10 max-w-[1400px] mx-auto w-full">
        <div className="flex items-end justify-between gap-8 flex-wrap">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-fg-subtle font-medium">
              库 · Library
            </div>
            <h1 className="font-display text-[44px] leading-[1.04] font-semibold tracking-[-0.02em] mt-2.5">
              图像库
            </h1>
            <p className="text-sm text-fg-muted mt-3.5">
              {result ? (
                <>
                  <span className="tabular-nums text-fg">{result.albumCount}</span> 个文件夹
                  <span className="text-fg-subtle/60 mx-1.5">·</span>
                  <span className="tabular-nums text-fg">
                    {(result.smartCollections ?? []).length}
                  </span>{' '}
                  个标签
                  {lastScanAt && (
                    <span className="text-fg-subtle ml-1.5">
                      · 上次更新 {formatTime(lastScanAt)}
                    </span>
                  )}
                </>
              ) : (
                '尚未加载图像库'
              )}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            {primaryAction ? (
              <button
                onClick={() => onContinue(primaryAction.card)}
                className="inline-flex items-center gap-2.5 h-11 px-5 rounded-lg bg-accent text-accent-contrast hover:bg-accent-hover transition-colors text-sm font-medium shadow-sm"
              >
                <PlayFilledIcon size={14} />
                <span>继续上次</span>
                <span className="text-[11px] opacity-70 tabular-nums">
                  {primaryAction.card.progress
                    ? `${primaryAction.card.progress.index + 1}/${primaryAction.card.progress.total}`
                    : ''}
                </span>
              </button>
            ) : (
              <button
                onClick={onShuffle}
                disabled={!hasContent}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-accent text-accent-contrast hover:bg-accent-hover transition-colors text-sm font-medium shadow-sm disabled:opacity-40"
              >
                <ShuffleIcon size={14} />
                <span>随机一本</span>
              </button>
            )}
            <button
              onClick={() => startScan.mutate()}
              disabled={startScan.isPending || sse.isRunning}
              className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-lg text-[13px] text-fg-muted hover:text-fg hover:bg-bg-subtle transition-colors disabled:opacity-50"
              title="扫描 (Ctrl+S)"
            >
              <RefreshIcon size={13} />
              <span>{scanLabel}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Filter strip — 扁平贴主区,接管原 toolbar 的视图/排序 */}
      {hasContent && (
        <ListFilterBar
          viewChips={[
            { key: 'all', label: '全部', count: counts.all },
            { key: 'album', label: '文件夹', count: counts.album },
            { key: 'collection', label: '集合', count: counts.collection },
            { key: 'smart', label: '标签', count: counts.smart },
          ]}
          activeViewKey={view}
          onChangeView={(k) => setView(k as typeof view)}
          totalCount={filtered.length}
        />
      )}

      {/* 智能推荐：3 大区,按优先级 */}
      {hasContent && !query && (
        <div className="max-w-[1400px] mx-auto w-full">
          {/* 继续阅读 — 大横向卡,只在有进度时显示 */}
          {inProgress.length > 0 && (
            <RowSection
              title="继续阅读"
              icon={<PlayFilledIcon size={11} className="text-fg-muted" />}
              count={inProgress.length}
            >
              <AlbumGrid items={inProgress} variant={viewMode} />
            </RowSection>
          )}

          {/* 挑新的看:三组并列 (全新 / 重温 / 最近加入) */}
          {(fresh.length > 0 || rewind.length > 0 || recentAdded.length > 0) && (
            <RowSection
              title="挑新的看"
              icon={<SparklesIcon size={11} className="text-fg-muted" />}
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-10">
                {fresh.length > 0 && (
                  <SubColumn
                    title="全新"
                    subtitle="还没看过"
                    count={fresh.length}
                    icon={<SparklesIcon size={11} />}
                    items={fresh}
                  />
                )}
                {rewind.length > 0 && (
                  <SubColumn
                    title="重温"
                    subtitle={`${REWIND_DAYS}+ 天没看`}
                    count={rewind.length}
                    icon={<RewindIcon size={11} />}
                    items={rewind}
                  />
                )}
                {recentAdded.length > 0 && (
                  <SubColumn
                    title="最近加入"
                    count={recentAdded.length}
                    icon={<ClockIcon size={11} />}
                    items={recentAdded}
                  />
                )}
              </div>
            </RowSection>
          )}

          {/* 热门标签 */}
          {topTags.length > 0 && (
            <RowSection
              title="热门标签"
              icon={<StarIcon size={11} className="text-fg-muted" filled />}
              count={topTags.length}
            >
              <AlbumGrid items={topTags} variant={viewMode} />
            </RowSection>
          )}
        </div>
      )}

      {/* 全部图像 */}
      {hasContent && (
        <section className="max-w-[1400px] mx-auto w-full">
          <div className="px-6 lg:px-10 pt-6 pb-3 flex items-center gap-2">
            <LibraryIcon size={12} className="text-fg-muted" />
            <h2 className="text-[11px] uppercase tracking-[0.18em] text-fg-muted font-medium">
              全部图像
            </h2>
            <span className="text-[11px] text-fg-subtle tabular-nums">{filtered.length}</span>
            {favCount > 0 && (
              <>
                <span className="text-fg-subtle/40 mx-1">·</span>
                <button
                  onClick={() => navigate('/favorites')}
                  className="inline-flex items-center gap-1 text-[11px] text-warning/90 hover:text-warning transition-colors"
                >
                  <StarIcon size={10} filled />
                  <span>{favCount} 收藏</span>
                </button>
              </>
            )}
          </div>

          {isLoadingInitial ? (
            <EmptyState
              title="正在加载图像库"
              description="首次启动可能需要几秒钟。"
              icon={
                <div className="w-10 h-10 border-2 border-fg-subtle border-t-accent rounded-full animate-spin" />
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
            <div className="px-6 lg:px-10 pb-10">
              <AlbumGrid items={filtered} variant={viewMode} />
            </div>
          )}
        </section>
      )}

      {/* 空状态 — 尚未扫描 */}
      {!hasContent && !isLoadingInitial && (
        <section className="px-6 lg:px-10 max-w-[1400px] mx-auto w-full">
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
        </section>
      )}

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
    return result.collections?.find((c) => c.path === p)?.albums?.[0]?.modTime ?? ''
  }
  if (id.startsWith('s:')) {
    const author = id.slice(2)
    const sc = (result.smartCollections ?? []).find((s) => s.author === author)
    return sc?.albums?.[0]?.modTime ?? ''
  }
  return ''
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

// 横向 row section: 标题 + 计数 + 子内容
function RowSection({
  title,
  icon,
  count,
  children,
}: {
  title: string
  icon: React.ReactNode
  count?: number
  children: React.ReactNode
}) {
  return (
    <section className="px-6 lg:px-10 py-8">
      <div className="flex items-center gap-2 mb-5">
        {icon}
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-fg-muted font-medium">
          {title}
        </h2>
        {count !== undefined && (
          <span className="text-[11px] text-fg-subtle tabular-nums">{count}</span>
        )}
      </div>
      {children}
    </section>
  )
}

// 3 列子栏:全新 / 重温 / 最近加入
// 用 list 变体:每列内 4 项,横向 cover(更小) + 标题 + 元数据,信息密度更高
function SubColumn({
  title,
  subtitle,
  count,
  icon,
  items,
}: {
  title: string
  subtitle?: string
  count: number
  icon: React.ReactNode
  items: CardData[]
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          {icon}
          <h3 className="text-[12.5px] font-medium text-fg">{title}</h3>
        </div>
        {subtitle && <span className="text-[11px] text-fg-subtle">{subtitle}</span>}
        <span className="text-[11px] text-fg-subtle tabular-nums ml-auto">{count}</span>
      </div>
      <div className="space-y-1.5">
        {items.map((it) => (
          <AlbumCard key={it.id} data={it} variant="list" />
        ))}
      </div>
    </div>
  )
}
