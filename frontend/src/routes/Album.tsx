import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useLibraryStore } from '../store/libraryStore'
import { useSearchStore } from '../store/searchStore'
import { useFavorites } from '../hooks/useFavorites'
import { useViewerContextSync } from '../hooks/useViewerContextSync'
import { historyApi } from '../api/prefs'
import { thumbUrl } from '../api/thumbs'
import { useUIStore } from '../store/uiStore'
import type { CardData } from '../components/album/AlbumGrid'
import AlbumGrid from '../components/album/AlbumGrid'
import EmptyState from '../components/common/EmptyState'
import { albumsApi } from '../api/albums'
import { decodeFavPath } from '../utils/path'
import {
  ChevronLeftIcon,
  ReaderIcon,
  StarIcon,
  FolderIcon,
  PlayFilledIcon,
  CheckIcon,
  MoreHorizontalIcon,
  ClockIcon,
  ImageIcon,
  CopyIcon,
  HelpIcon,
} from '../components/common/Icon'
import { useReadingProgress } from '../hooks/useReadingProgress'
import { useAlbumActions } from '../hooks/useAlbumActions'
import PropertiesDialog from '../components/common/PropertiesDialog'
import ContextMenu, { type AnyMenuItem } from '../components/album/ContextMenu'
import { fsCapabilities } from '../api/fs'
import type { ViewerContextEntry } from '../utils/viewerContext'

interface AlbumDetail {
  type: 'album'
  path: string
  name: string
  imageFiles: string[]
  coverImage: string
  imageCount: number
  author?: string
  folderSize: number
  modTime: string
}

interface CollectionDetail {
  type: 'collection'
  path: string
  name: string
  albums: AlbumDetail[]
  albumCount: number
}

interface SmartDetail {
  type: 'smartCollection'
  author: string
  albums: AlbumDetail[]
  albumCount: number
  coverImage: string
}

type Detail = AlbumDetail | CollectionDetail | SmartDetail

// 相册视图：
//   - 相册 → 图片网格，点击进入查看器
//   - 集合/智能集合 → 嵌套相册列表
//   - 缺数据时给出明确引导
export default function Album() {
  const params = useParams()
  const navigate = useNavigate()
  const rawPath = decodeFavPath('/albums/' + (params['*'] ?? ''))
  const isSmart = rawPath.startsWith('smart:')
  const realPath = isSmart ? rawPath.slice(6) : rawPath

  const result = useLibraryStore((s) => s.result)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)
  const query = useSearchStore((s) => s.query)
  const sortBy = useSearchStore((s) => s.sortBy)
  const viewMode = useUIStore((s) => s.viewMode)
  const { add: addFav, toggle: toggleFav, favorites } = useFavorites()
  const pushToast = useUIStore((s) => s.pushToast)

  useEffect(() => {
    if (!result) loadFromBackend()
  }, [result, loadFromBackend])

  const localDetail = useMemo<Detail | null>(() => {
    if (!result) return null
    if (isSmart) {
      const sc = (result.smartCollections ?? []).find((s) => s.author === realPath)
      if (!sc) return null
      return {
        type: 'smartCollection',
        author: sc.author,
        albums: sc.albums.map((a) => ({
          type: 'album',
          path: a.path,
          name: a.name,
          imageFiles: [],
          coverImage: a.coverImage,
          imageCount: a.imageCount,
          author: a.author,
          folderSize: 0,
          modTime: '',
        })),
        albumCount: sc.albumCount,
        coverImage: sc.coverImage,
      }
    }
    const found = result.albums.find((a) => a.path === realPath)
    if (found) {
      return {
        type: 'album',
        path: found.path,
        name: found.name,
        imageFiles: (found as unknown as { imageFiles?: string[] }).imageFiles ?? [],
        coverImage: found.coverImage,
        imageCount: found.imageCount,
        author: found.author,
        folderSize: (found as unknown as { folderSize?: number }).folderSize ?? 0,
        modTime: (found as unknown as { modTime?: string }).modTime ?? '',
      }
    }
    const coll = (result.collections ?? []).find((c) => c.path === realPath)
    if (coll) {
      return {
        type: 'collection',
        path: coll.path,
        name: coll.name,
        albums: coll.albums.map((a) => ({
          type: 'album',
          path: a.path,
          name: a.name,
          imageFiles: [],
          coverImage: a.coverImage,
          imageCount: a.imageCount,
          author: a.author,
          folderSize: 0,
          modTime: '',
        })),
        albumCount: coll.albumCount,
      }
    }
    return null
  }, [result, isSmart, realPath])

  const needBackendDetail =
    localDetail?.type === 'album' && localDetail.imageFiles.length === 0
  const remoteDetail = useQuery({
    queryKey: ['album-detail', realPath],
    queryFn: async () => {
      const r = await albumsApi.detail(rawPath)
      return r.data as Detail
    },
    enabled: !!needBackendDetail,
  })

  const detail = needBackendDetail ? (remoteDetail.data ?? localDetail) : localDetail

  useEffect(() => {
    if (!detail) return
    if (detail.type === 'album') {
      historyApi
        .add({
          path: detail.path,
          name: detail.name,
          imageCount: detail.imageCount,
        })
        .catch(() => {})
    }
  }, [detail?.type === 'album' ? detail.path : null])

  if (!result) {
    return (
      <EmptyState
        title="尚未扫描图像库"
        description="回到主页点击「扫描」加载图像库。"
        action={
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors text-sm"
          >
            返回主页
          </button>
        }
      />
    )
  }

  if (!detail) {
    return (
      <EmptyState
        title="找不到此文件夹"
        description={`路径: ${realPath}`}
        action={
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border hover:bg-bg-subtle text-sm"
          >
            返回主页
          </button>
        }
      />
    )
  }

  if (detail.type === 'collection' || detail.type === 'smartCollection') {
    const favPath = detail.type === 'smartCollection' ? `smart:${detail.author}` : detail.path
    const isFav = favorites.includes(favPath)
    return (
      <CollectionView
        detail={detail}
        query={query}
        sortBy={sortBy}
        viewMode={viewMode}
        onBack={() => navigate(-1)}
        isFavorite={isFav}
        onOpenAuthor={
          detail.type === 'smartCollection'
            ? (tag) => navigate(`/tags/${encodeURIComponent(tag)}`)
            : undefined
        }
        onToggleFav={async () => {
          if (detail.type === 'smartCollection') {
            try {
              await toggleFav(favPath)
              pushToast({ kind: 'success', message: isFav ? '已取消收藏' : '已加入收藏' })
            } catch {
              pushToast({ kind: 'error', message: '操作失败' })
            }
          } else {
            try {
              await addFav(favPath)
              pushToast({ kind: 'success', message: '已加入收藏' })
            } catch {
              pushToast({ kind: 'error', message: '操作失败' })
            }
          }
        }}
      />
    )
  }

  return <AlbumView detail={detail} onBack={() => navigate(-1)} />
}

// Album 详情页:大封面 hero + 进度条 + 动态 CTA + 缩略图网格
function AlbumView({ detail, onBack }: { detail: AlbumDetail; onBack: () => void }) {
  const navigate = useNavigate()
  const [gridSize, setGridSize] = useState<'sm' | 'md' | 'lg'>('md')
  const pushToast = useUIStore((s) => s.pushToast)
  const { data: progress } = useReadingProgress(detail.path)
  const { add: addFav, toggle: toggleFav, favorites } = useFavorites()
  const isFav = favorites.includes(detail.path)
  const startIndex = progress && progress.index > 0 && progress.index < detail.imageFiles.length
    ? progress.index
    : 0

  const [moreOpen, setMoreOpen] = useState(false)
  const [propsOpen, setPropsOpen] = useState(false)
  // 用 key 强制 PropertiesDialog 重新挂载（重新打开时）
  const [propsKey, setPropsKey] = useState(0)
  const moreRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null)

  useEffect(() => {
    if (!moreOpen) return
    const onClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    // 下一 tick 注册，避免本次点击事件冒泡到 window 后立即关闭
    const id = window.setTimeout(() => {
      window.addEventListener('mousedown', onClick)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  const openViewer = (idx: number) => {
    const qs = new URLSearchParams({
      path: detail.path,
      index: String(idx),
      name: detail.name,
    })
    navigate(`/viewer?${qs.toString()}`)
  }

  // 用 AlbumActions 钩子,实现菜单里的复制路径 / 资源管理器 / 属性
  const actions = useAlbumActions(
    {
      id: detail.path,
      variant: 'album',
      title: detail.name,
      subtitle: detail.author,
      count: detail.imageCount,
      coverPath: detail.coverImage,
      to: `/albums/${encodeURIComponent(detail.path)}`,
      isFavorite: isFav,
    },
    () => setPropsKey((k) => k + 1),
  )

  const openInExplorer = () => {
    if (!fsCapabilities.allowOsOpen) {
      pushToast({ kind: 'info', message: 'allowOsOpen 已关闭,可在设置中开启' })
      return
    }
    actions.openInExplorer().catch(() => {})
  }

  const copyPath = () => {
    actions.copyPath()
      .then(() => pushToast({ kind: 'success', message: '路径已复制' }))
      .catch(() => pushToast({ kind: 'error', message: '复制失败' }))
  }

  const toggleFavorite = () => {
    if (isFav) {
      toggleFav(detail.path)
        .then(() => pushToast({ kind: 'success', message: '已取消收藏' }))
        .catch(() => pushToast({ kind: 'error', message: '操作失败' }))
    } else {
      addFav(detail.path)
        .then(() => pushToast({ kind: 'success', message: '已加入收藏' }))
        .catch(() => pushToast({ kind: 'error', message: '操作失败' }))
    }
  }

  // 防御：API 可能返回 null
  const imageFiles = detail.imageFiles ?? []

  if (imageFiles.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="该文件夹暂无图片"
          description="可能扫描时尚未加载到图片列表，请重新扫描。"
        />
      </div>
    )
  }

  const gridCls =
    gridSize === 'sm'
      ? 'grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10'
      : gridSize === 'lg'
        ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
        : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.index / Math.max(1, progress.total - 1)) * 100))
      : null
  const isFinished =
    !!progress && progress.total > 0 && progress.index >= progress.total - 1

  return (
    <div className="flex flex-col h-full">
      {/* Hero: 大封面 + 渐变叠加 + 标题 + CTA */}
      <section className="relative bg-bg-elevated border-b border-border-faint">
        <div className="absolute inset-0 overflow-hidden">
          <img
            src={thumbUrl(detail.coverImage)}
            alt=""
            className="w-full h-full object-cover scale-110 blur-2xl opacity-25"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg-elevated/40 to-bg-elevated" />
        </div>

        <div className="relative px-6 lg:px-10 pt-6 pb-8 max-w-[1400px] mx-auto w-full">
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg transition-colors"
            >
              <ChevronLeftIcon size={12} />
              <span>返回</span>
            </button>
            <span className="text-fg-subtle/50 text-xs">/</span>
            <span className="text-xs text-fg-muted truncate">{detail.name}</span>
          </div>

          <div className="flex items-end gap-8 flex-wrap">
            {/* 大封面缩略图 */}
            <div className="relative w-32 h-44 sm:w-40 sm:h-56 rounded-lg overflow-hidden border border-border shadow-md shrink-0 bg-bg-subtle">
              <img
                src={thumbUrl(detail.coverImage)}
                alt={detail.name}
                className="w-full h-full object-cover"
              />
              {progressPct !== null && progressPct > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              )}
            </div>

            {/* 标题 + 元信息 + CTA */}
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.01em] leading-tight">
                {detail.name}
              </h1>
              <div className="flex items-center gap-2 text-sm text-fg-muted mt-2 flex-wrap">
                {detail.author && (
                  <>
                    <span className="text-fg">{detail.author}</span>
                    <span className="text-fg-subtle/50">·</span>
                  </>
                )}
                <span className="tabular-nums">{detail.imageCount} 张</span>
                {detail.modTime && (
                  <>
                    <span className="text-fg-subtle/50">·</span>
                    <span className="text-fg-subtle inline-flex items-center gap-1">
                      <ClockIcon size={11} />
                      {formatRelative(detail.modTime)}
                    </span>
                  </>
                )}
                {isFinished && (
                  <>
                    <span className="text-fg-subtle/50">·</span>
                    <span className="inline-flex items-center gap-1 text-success text-[12px]">
                      <CheckIcon size={11} />
                      已读完
                    </span>
                  </>
                )}
              </div>

              {/* 阅读进度条: 显眼 */}
              {progressPct !== null && progressPct > 0 && (
                <div className="mt-4 max-w-md">
                  <div className="flex items-center justify-between text-[11px] text-fg-muted mb-1.5 tabular-nums">
                    <span>阅读进度</span>
                    <span>
                      {progress!.index + 1} / {progress!.total} · {progressPct}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-bg-strong rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* CTA 行 */}
              <div className="mt-5 flex items-center gap-2 flex-wrap">
                {progressPct !== null && progressPct > 0 ? (
                  <button
                    onClick={() => openViewer(startIndex)}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-accent text-accent-contrast hover:bg-accent-hover transition-colors text-sm font-medium shadow-sm"
                  >
                    <PlayFilledIcon size={13} />
                    <span>继续上次</span>
                    <span className="text-[11px] opacity-70 tabular-nums">
                      {progress!.index + 1}/{progress!.total}
                    </span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      openViewer(0)
                      pushToast({ kind: 'info', message: '开始浏览' })
                    }}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-accent text-accent-contrast hover:bg-accent-hover transition-colors text-sm font-medium shadow-sm"
                  >
                    <ReaderIcon size={13} />
                    <span>开始浏览</span>
                  </button>
                )}

                <button
                  onClick={toggleFavorite}
                  className={`inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg text-[13px] transition-colors ${
                    isFav
                      ? 'bg-warning/10 text-warning border border-warning/30'
                      : 'border border-border-faint text-fg-muted hover:text-fg hover:bg-bg-subtle'
                  }`}
                >
                  <StarIcon size={13} filled={isFav} />
                  <span>{isFav ? '已收藏' : '收藏'}</span>
                </button>

                <div ref={moreRef} className="relative">
                  <button
                    onClick={() => setMoreOpen((v) => !v)}
                    className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-fg-muted hover:text-fg hover:bg-bg-subtle border border-border-faint transition-colors"
                    title="更多"
                    aria-label="更多操作"
                  >
                    <MoreHorizontalIcon size={15} />
                  </button>
                  {moreOpen && (
                    <div className="absolute right-0 top-full mt-1.5 min-w-[180px] bg-bg-elevated border border-border rounded-lg shadow-lg py-1 z-40 fade-up">
                      <button
                        onClick={() => {
                          setMoreOpen(false)
                          openInExplorer()
                        }}
                        disabled={!fsCapabilities.allowOsOpen}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <FolderIcon size={12} />
                        <span>在资源管理器中打开</span>
                      </button>
                      <button
                        onClick={() => {
                          setMoreOpen(false)
                          copyPath()
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
                      >
                        <CopyIcon size={12} />
                        <span>复制路径</span>
                      </button>
                      <div className="my-1 border-t border-border-faint" />
                      <button
                        onClick={() => {
                          setMoreOpen(false)
                          setPropsOpen(true)
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
                      >
                        <HelpIcon size={12} />
                        <span>属性</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 缩略图网格 */}
      <div className="px-6 lg:px-10 pt-5 pb-3 flex items-center gap-3 max-w-[1400px] mx-auto w-full">
        <ImageIcon size={12} className="text-fg-muted" />
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-fg-muted font-medium">
          所有页面
        </h2>
        <span className="text-[11px] text-fg-subtle tabular-nums">{imageFiles.length} 张</span>
        <span className="text-fg-subtle/40">·</span>
        <div className="flex items-center border border-border-faint rounded-md overflow-hidden text-xs ml-auto">
          {(['sm', 'md', 'lg'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setGridSize(k)}
              className={`h-7 px-2.5 transition-colors ${
                gridSize === k
                  ? 'bg-bg-subtle text-fg'
                  : 'text-fg-muted hover:text-fg'
              }`}
              title={k === 'sm' ? '密集' : k === 'md' ? '标准' : '宽松'}
              aria-label={k === 'sm' ? '密集' : k === 'md' ? '标准' : '宽松'}
            >
              {(k === 'sm' ? 'S' : k === 'md' ? 'M' : 'L')}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className={`grid ${gridCls} gap-2 px-6 lg:px-10 pb-10 max-w-[1400px] mx-auto`}>
          {imageFiles.map((img, i) => {
            const isCurrent = progress && i === progress.index
            const isPast = progress && i < progress.index
            return (
              <button
                key={img}
                onClick={() => openViewer(i)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({ x: e.clientX, y: e.clientY, index: i })
                }}
                className={`group relative aspect-[3/4] bg-bg-subtle rounded overflow-hidden transition-all ${
                  isCurrent
                    ? 'ring-2 ring-accent'
                    : isPast
                      ? 'opacity-70'
                      : ''
                }`}
                title={`第 ${i + 1} 张`}
              >
                <img
                  src={thumbUrl(img)}
                  alt={`第 ${i + 1} 张`}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
                {isCurrent && (
                  <div className="absolute top-1.5 left-1.5 bg-accent text-accent-fg text-[10px] font-medium px-1.5 py-0.5 rounded">
                    当前
                  </div>
                )}
                <div className="absolute bottom-1.5 right-1.5 text-[10px] bg-bg-elevated/85 backdrop-blur px-1.5 py-0.5 rounded text-fg-muted tabular-nums">
                  {i + 1}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            { id: 'open', label: '打开此页', icon: '›' },
            {
              id: 'favorite',
              label: isFav ? '取消收藏' : '收藏',
              icon: '★',
            },
            { id: 'sep1', separator: true } as AnyMenuItem,
            {
              id: 'explorer',
              label: '在资源管理器中打开',
              icon: '↗',
              disabled: !fsCapabilities.allowOsOpen,
            },
            { id: 'copy', label: '复制路径', icon: '⧉' },
            { id: 'sep2', separator: true } as AnyMenuItem,
            { id: 'properties', label: '属性', icon: 'ⓘ' },
          ]}
          onSelect={(id) => {
            switch (id) {
              case 'open':
                openViewer(contextMenu.index)
                break
              case 'favorite':
                toggleFavorite()
                break
              case 'explorer':
                openInExplorer()
                break
              case 'copy':
                copyPath()
                break
              case 'properties':
                setPropsOpen(true)
                break
            }
            setContextMenu(null)
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      <PropertiesDialog
        key={propsKey}
        open={propsOpen}
        absPath={detail.path}
        onClose={() => setPropsOpen(false)}
      />
    </div>
  )
}

function CollectionView({
  detail,
  query,
  sortBy,
  viewMode,
  onBack,
  onToggleFav,
  isFavorite,
  onOpenAuthor,
}: {
  detail: CollectionDetail | SmartDetail
  query: string
  sortBy: 'name' | 'count' | 'recent'
  viewMode: 'grid' | 'list'
  onBack: () => void
  onToggleFav: () => void
  isFavorite: boolean
  onOpenAuthor?: (author: string) => void
}) {
  const isSmart = detail.type === 'smartCollection'
  const title = isSmart ? detail.author : detail.name

  const filtered = useMemo(() => {
    const items = detail.albums.filter((a) => !query || a.name.toLowerCase().includes(query.toLowerCase()))
    switch (sortBy) {
      case 'count':
        return items.sort((a, b) => b.imageCount - a.imageCount)
      case 'recent':
        return items.sort((a, b) => (b.modTime || '').localeCompare(a.modTime || ''))
      default:
        return items.sort((a, b) => a.name.localeCompare(b.name))
    }
  }, [detail.albums, query, sortBy])

  const cards: CardData[] = filtered.map((a) => ({
    id: 'a:' + a.path,
    variant: 'album',
    title: a.name,
    subtitle: a.author,
    count: a.imageCount,
    coverPath: a.coverImage,
    to: `/albums/${encodeURIComponent(a.path)}`,
  }))

  // 集合/智能合集页面作为上下文源
  const collEntries = useMemo<ViewerContextEntry[]>(
    () => cards.map((c) => ({ key: c.to, to: c.to, name: c.title })),
    [cards],
  )
  useViewerContextSync(
    isSmart
      ? { type: 'tag', tag: detail.author }
      : { type: 'album', parentPath: detail.path },
    collEntries,
  )

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 lg:px-10 pt-8 pb-5">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-fg mb-4 transition-colors"
        >
          <ChevronLeftIcon size={12} />
          <span>返回</span>
        </button>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {isSmart ? (
                <StarIcon size={13} className="text-fg-muted" filled />
              ) : (
                <FolderIcon size={13} className="text-fg-muted" />
              )}
              <span className="text-[11px] uppercase tracking-[0.14em] text-fg-muted">
                {isSmart ? '合集' : '集合'}
              </span>
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight truncate">
              {title}
            </h1>
            <div className="text-sm text-fg-muted mt-1.5">
              <span className="tabular-nums">{detail.albumCount} 卷</span>
            </div>
          </div>
          {isSmart && onOpenAuthor ? (
            <button
              onClick={() => onOpenAuthor(title)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs bg-accent text-accent-contrast hover:bg-accent-hover transition-colors"
            >
              <span>查看标签页</span>
            </button>
          ) : (
            <button
              onClick={onToggleFav}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs transition-colors ${
                isFavorite
                  ? 'bg-warning/10 text-warning hover:bg-warning/15'
                  : 'border border-border-faint hover:bg-bg-subtle text-fg-muted'
              }`}
            >
              <StarIcon size={12} filled={isFavorite} />
              <span>{isFavorite ? '已收藏' : '收藏'}</span>
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {cards.length === 0 ? (
          <EmptyState title="无匹配结果" description="试试修改搜索条件或排序。" />
        ) : (
          <AlbumGrid items={cards} variant={viewMode} />
        )}
      </div>
    </div>
  )
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diff = (now - d.getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
