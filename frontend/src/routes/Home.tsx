import { useEffect, useMemo, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useLibraryStore } from '../store/libraryStore'
import { useSearchStore } from '../store/searchStore'
import { useScanSSE } from '../hooks/useScanSSE'
import { useFavorites } from '../hooks/useFavorites'
import { useAllProgress } from '../hooks/useReadingProgress'
import { useUnreadAlbums } from '../hooks/useUnreadAlbums'
import { useGalleryContextSync } from '../hooks/useGalleryContextSync'
import { scanApi, type ScanResult } from '../api/scan'
import AlbumGrid, { type CardData } from '../components/album/AlbumGrid'
import { ListFilterBar } from '../components/common/ListFilterBar'
import EmptyState from '../components/common/EmptyState'
import YearTimeline from '../components/home/YearTimeline'
import { useUIStore } from '../store/uiStore'
import { albumRoute, tagRoute, decodeFavPath } from '../utils/path'
import type { GalleryContextEntry } from '../utils/galleryContext'
import { groupByYear, type YearGroup } from '../utils/albumGrouping'
import {
  PlayFilledIcon,
  StarIcon,
  ShuffleIcon,
  RefreshIcon,
  LibraryIcon,
  ClockIcon,
  CloseIcon,
  ImageIcon,
  SparkleIcon,
  ArrowRightLineIcon,
} from '../components/common/Icon'

// 卡片全集（album + collection + smart），用于"全部图像" filter 网格
function buildCards(r: ScanResult | null): CardData[] {
  if (!r) return []
  const items: CardData[] = []
  for (const a of r.albums) {
    items.push({
      id: 'a:' + a.path,
      variant: 'album',
      title: a.name,
      displayTitle: a.displayName,
      subtitle: a.author || undefined,
      count: a.imageCount,
      imageCount: a.imageCount,
      videoCount: a.videoCount ?? 0,
      coverPath: a.coverImage,
      coverKind: a.coverKind,
      to: albumRoute(a.path),
      sourceRoot: a.sourceRoot,
      sourceName: a.sourceName,
    })
  }
  for (const c of r.collections ?? []) {
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
  for (const s of r.smartCollections ?? []) {
    items.push({
      id: 's:' + s.author,
      variant: 'smart',
      title: s.author,
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

  // "全部图像" section 的 ref：年份筛选触发后自动滚到这里
  const gridRef = useRef<HTMLDivElement>(null)

  const query = useSearchStore((s) => s.query)
  const sortBy = useSearchStore((s) => s.sortBy)
  const view = useSearchStore((s) => s.view)
  const setView = useSearchStore((s) => s.setView)
  const yearFilter = useSearchStore((s) => s.yearFilter)
  const setYearFilter = useSearchStore((s) => s.setYearFilter)
  const viewMode = useUIStore((s) => s.viewMode)

  const { favorites } = useFavorites()
  // 未读列表:Home 顶部 hero 直接展示前 6 张 + 链接到 /unread
  // 已有 useUnreadAlbums hook(见 hooks/useUnreadAlbums.ts),复用避免重新
  // 实现 progress 派发逻辑。
  const { cards: unreadCards, count: unreadCount } = useUnreadAlbums()

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

  // 随机未读:从未读列表里挑一本(若未读为空,给个 toast 引导去 /unread 看空态)
  const onShuffleUnread = () => {
    if (unreadCards.length === 0) {
      pushToast({ kind: 'info', message: '没有未读相册可跳' })
      return
    }
    const pick = unreadCards[Math.floor(Math.random() * unreadCards.length)]
    // pick.to 形如 /albums/<encoded>;Gallery 期望 ?path= 原 path 形式
    const path = decodeFavPath(pick.to)
    navigate(albumRoute(path))
  }

  const cards = useMemo(() => buildCards(result), [result])

  // 继续上次：需要进度数据
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

  // 时光轴：按年份分组（画廊模式，替代早期"全新/重温/最近加入"的分区）
  const yearGroups = useMemo<YearGroup[]>(() => groupByYear(result), [result])

  // 切换视图到 collection/smart 时清掉 yearFilter（年份只对 album 有意义）
  useEffect(() => {
    if (yearFilter !== null && view !== 'all' && view !== 'album') {
      setYearFilter(null)
    }
  }, [view, yearFilter, setYearFilter])

  // 全部图像 filter（视图 + 搜索 + 年份筛选 + 排序）
  const yearFilterActive = yearFilter !== null && (view === 'all' || view === 'album')
  const filtered = useMemo(() => {
    const list = cards.filter((it) => {
      if (view !== 'all' && it.variant !== view) return false
      // 年份筛选：用 item 自身的 title 提取年份来匹配。
      // collection/smart 自身也可能没有年份（或有），让 extractYear 自然处理，
      // 避免把"萍乡中学"这种没年份的 collection 因为不是 album 就被误删。
      if (yearFilterActive) {
        if (yearFilter === 'other') {
          if (extractYearOrNull(it.title) !== null) return false
        } else if (typeof yearFilter === 'number') {
          if (extractYearOrNull(it.title) !== yearFilter) return false
        }
      }
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
          (a, b) =>
            +new Date(recentTime(result, b.id)) - +new Date(recentTime(result, a.id)),
        )
      default:
        return withProgress.sort((a, b) => a.title.localeCompare(b.title))
    }
  }, [cards, query, sortBy, view, yearFilter, yearFilterActive, progressMap, result])

  const homeEntries = useMemo<GalleryContextEntry[]>(
    () =>
      filtered
        .filter((c) => c.variant === 'album')
        .map((c) => ({ key: decodeFavPath(c.to), to: c.to, name: c.title })),
    [filtered],
  )
  useGalleryContextSync({ type: 'home' }, homeEntries)

  const counts = useMemo(() => {
    const c = { all: cards.length, album: 0, collection: 0, smart: 0 }
    for (const it of cards) c[it.variant]++
    return c
  }, [cards])

  const favCount = favorites.length
  const isLoadingInitial = !result && (sse.isRunning || sse.scanId)
  const hasContent = !!result && cards.length > 0

  // 主 CTA：有进度 → 继续上次；否则 → 随机翻翻
  const primaryAlbum = inProgress[0]
  const scanLabel = sse.isRunning
    ? '扫描中…'
    : startScan.isPending
      ? '启动中…'
      : '重新扫描'

  // 「继续上次」直跳画廊：进首页最大的目的是「接着看」，
  // 中转 Album 详情会多一次点击，对随手翻翻的场景不友好。
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
    navigate(`/gallery?${qs.toString()}`)
  }

  // 年份筛选的"全部图像"section 顶部 chip
  const yearFilterLabel = yearFilter === 'other' ? '其他' : String(yearFilter)

  return (
    <div className="min-h-full">
      {/* ScanProgress 已提升到 AppShell，跨路由常驻显示 */}

      {/* === Hero: 标题 + 统计 + 4 动作卡 + 重新扫描 === */}
      <section className="px-6 lg:px-10 pt-12 pb-8 max-w-[1400px] mx-auto w-full">
        <div className="flex items-end justify-between gap-8 flex-wrap mb-6">
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
                  <span className="tabular-nums text-fg">{counts.all}</span> 个文件夹
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
          <button
            onClick={() => startScan.mutate()}
            disabled={startScan.isPending || sse.isRunning}
            className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-lg text-[13px] text-fg-muted hover:text-fg hover:bg-bg-subtle border border-border-faint transition-colors disabled:opacity-50"
            title="扫描 (Ctrl+S)"
          >
            <RefreshIcon size={13} />
            <span>{scanLabel}</span>
          </button>
        </div>

        {/* === 4 动作卡（核心入口） === */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 1. 主 CTA：继续上次（如果有进度）or 随机翻翻 */}
          {primaryAlbum ? (
            <ActionCard
              icon={<PlayFilledIcon size={14} />}
              title="继续上次"
              subtitle={primaryAlbum.title}
              meta={
                primaryAlbum.progress
                  ? `${primaryAlbum.progress.index + 1}/${primaryAlbum.progress.total}`
                  : ''
              }
              variant="primary"
              onClick={() => onContinue(primaryAlbum)}
            />
          ) : (
            <ActionCard
              icon={<ShuffleIcon size={14} />}
              title="随机翻翻"
              subtitle="随便看一本"
              meta="(R)"
              variant="primary"
              disabled={!hasContent}
              onClick={onShuffle}
            />
          )}

          {/* 2. 随机翻翻（如果主 CTA 是继续上次，则并排展示） */}
          {primaryAlbum && (
            <ActionCard
              icon={<ShuffleIcon size={14} />}
              title="随机翻翻"
              subtitle="随便看一本"
              meta="(R)"
              variant="secondary"
              disabled={!hasContent}
              onClick={onShuffle}
            />
          )}

          {/* 3. 最近打开 */}
          <ActionCard
            icon={<ClockIcon size={14} />}
            title="最近打开"
            subtitle="按时间倒序"
            variant="secondary"
            onClick={() => navigate('/recents')}
          />

          {/* 4. 收藏（仅当有收藏时） */}
          {favCount > 0 && (
            <ActionCard
              icon={<StarIcon size={13} filled className="text-warning" />}
              title="收藏"
              subtitle={`${favCount} 项`}
              variant="secondary"
              onClick={() => navigate('/favorites')}
            />
          )}
        </div>
      </section>

      {/* === 视图筛选 === */}
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

      {/* === 未读 hero(有未读时置顶 6 张,直接引导用户进下一本)== */}
      {hasContent && unreadCards.length > 0 && (
        <UnreadHero cards={unreadCards} count={unreadCount} onShuffle={onShuffleUnread} />
      )}

      {/* === 时间线（仅当有内容时显示） === */}
      {hasContent && yearGroups.length > 0 && (
        <div className="py-6">
          <SectionHeader
            title="时间线"
            subtitle="按年份浏览 — 点击海报打开该年份,点右上漏斗可筛选下方网格"
            icon={<CalendarIconGlyph />}
          />
          <YearTimeline groups={yearGroups} gridRef={gridRef} />
        </div>
      )}

      {/* === 全部图像 === */}
      {hasContent && (
        <section
          ref={gridRef}
          className="max-w-[1400px] mx-auto w-full pt-8 pb-4 scroll-mt-6"
        >
          <div className="px-6 lg:px-10 flex items-center gap-2 flex-wrap">
            <LibraryIcon size={12} className="text-fg-muted" />
            <h2 className="text-[11px] uppercase tracking-[0.18em] text-fg-muted font-medium">
              {yearFilterActive ? '该年份的图像' : '全部图像'}
            </h2>
            <span className="text-[11px] text-fg-subtle tabular-nums">
              {filtered.length}
            </span>
            {yearFilterActive && (
              <button
                onClick={() => setYearFilter(null)}
                className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-accent-soft text-accent text-[11px] font-medium hover:bg-accent-soft/70 transition-colors"
                title="清除年份筛选"
              >
                <span>{yearFilterLabel}</span>
                <CloseIcon size={10} />
              </button>
            )}
            {favCount > 0 && !yearFilterActive && (
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
              title={yearFilterActive ? `「${yearFilterLabel}」没有匹配的图像` : '没有匹配的图像'}
              description={
                query
                  ? `没有匹配"${query}"的结果`
                  : yearFilterActive
                    ? '尝试切换到其他年份或清除筛选'
                    : '当前视图下没有内容'
              }
              icon={<ImageIcon size={20} />}
              action={
                <div className="flex items-center gap-2">
                  {yearFilterActive && (
                    <button
                      onClick={() => setYearFilter(null)}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border hover:bg-bg-subtle text-sm"
                    >
                      清除年份筛选
                    </button>
                  )}
                  <button
                    onClick={() => useSearchStore.getState().reset()}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border hover:bg-bg-subtle text-sm"
                  >
                    清除筛选
                  </button>
                </div>
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
            title="欢迎使用本地画廊"
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

// ===== helpers =====

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

// 同 albumGrouping.extractYear 但本组件独立调用，避免循环依赖
function extractYearOrNull(name: string): number | null {
  const m = name.match(/(\d{4})/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  if (y < 1900 || y > 2100) return null
  return y
}

// ===== 复用组件 =====

function ActionCard({
  icon,
  title,
  subtitle,
  meta,
  variant,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  meta?: string
  variant: 'primary' | 'secondary'
  disabled?: boolean
  onClick: () => void
}) {
  const base =
    'group relative flex flex-col gap-2 rounded-xl border p-4 sm:p-5 text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40'
  const primaryCls =
    'bg-accent text-accent-contrast border-transparent hover:bg-accent-hover shadow-sm hover:shadow-md'
  const secondaryCls =
    'bg-bg-elevated text-fg border-border hover:border-border-strong hover:-translate-y-0.5 hover:shadow-md'
  const disabledCls = 'opacity-40 cursor-not-allowed hover:!translate-y-0 hover:!shadow-sm'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variant === 'primary' ? primaryCls : secondaryCls} ${
        disabled ? disabledCls : ''
      }`}
    >
      <div
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${
          variant === 'primary'
            ? 'bg-accent-contrast/15 text-accent-contrast'
            : 'bg-bg-subtle text-fg-muted group-hover:text-fg'
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div
          className={`text-[14px] font-medium leading-tight ${
            variant === 'primary' ? 'text-accent-contrast' : 'text-fg'
          }`}
        >
          {title}
        </div>
        {subtitle && (
          <div
            className={`text-[11.5px] mt-0.5 truncate ${
              variant === 'primary'
                ? 'text-accent-contrast/70'
                : 'text-fg-muted'
            }`}
            title={subtitle}
          >
            {subtitle}
          </div>
        )}
      </div>
      {meta && (
        <div
          className={`absolute top-3 right-3 text-[10px] tabular-nums ${
            variant === 'primary'
              ? 'text-accent-contrast/60'
              : 'text-fg-subtle'
          }`}
        >
          {meta}
        </div>
      )}
    </button>
  )
}

function SectionHeader({
  title,
  subtitle,
  icon,
}: {
  title: string
  subtitle?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="px-6 lg:px-10 max-w-[1400px] mx-auto w-full flex items-center gap-3 mb-4">
      {icon}
      <h2 className="text-[11px] uppercase tracking-[0.18em] text-fg-muted font-medium">
        {title}
      </h2>
      {subtitle && (
        <span className="text-[11.5px] text-fg-subtle">{subtitle}</span>
      )}
    </div>
  )
}

// 日历图标 (用一个内联 svg,避免再 export 一遍)
function CalendarIconGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-fg-muted"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </svg>
  )
}

// 未读 hero:Home 主页顶部「还有 N 本没看」的引导区块。
//
// 设计目标:
//   - 让用户进首页立刻看到「未读」+「随机未读」的主行动,而不是要按 U
//     或翻到侧边栏才能找到
//   - 用前 6 张未读卡(2x3 / 3x2 网格)作为视觉锚点,而不是纯文字数字
//   - 「全部」按钮跳到 /unread 页看全量
//   - 没有未读时整个区块不渲染(由调用方控制)
export function UnreadHero({
  cards,
  count,
  onShuffle,
}: {
  cards: CardData[]
  count: number
  onShuffle: () => void
}) {
  const navigate = useNavigate()
  // 最多 6 张,让网格 3x2 居中显示。多于 6 张时,「全部 →」按钮引导去全量页
  const visible = cards.slice(0, 6)
  return (
    <section
      className="px-6 lg:px-10 max-w-[1400px] mx-auto w-full pt-8 pb-2"
      data-testid="unread-hero"
    >
      <div className="bg-accent-soft border border-accent/20 rounded-xl px-5 py-4">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <SparkleIcon size={13} className="text-accent" />
          <span className="text-[11px] uppercase tracking-[0.18em] text-accent font-medium">
            未读
          </span>
          <span className="text-[13px] text-fg">
            还有 <span className="font-semibold tabular-nums">{count}</span> 本没看
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onShuffle}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover text-xs font-medium transition-colors"
            >
              <ShuffleIcon size={12} />
              随机未读
            </button>
            <button
              onClick={() => navigate('/unread')}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border-faint text-fg-muted hover:text-fg hover:border-border-strong text-xs transition-colors"
            >
              全部
              <ArrowRightLineIcon size={11} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {visible.map((c) => (
            <AlbumGrid key={c.id} items={[c]} variant="grid" />
          ))}
        </div>
      </div>
    </section>
  )
}