import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useLibraryStore } from '../store/libraryStore'
import { useSearchStore } from '../store/searchStore'
import { useFavorites } from '../hooks/useFavorites'
import { useViewerContextSync } from '../hooks/useViewerContextSync'
import { historyApi } from '../api/prefs'
import { thumbUrl } from '../api/thumbs'
import { imageUrl } from '../api/images'
import { useUIStore } from '../store/uiStore'
import type { CardData } from '../components/album/AlbumGrid'
import AlbumGrid from '../components/album/AlbumGrid'
import EmptyState from '../components/common/EmptyState'
import { albumsApi } from '../api/albums'
import { decodeFavPath } from '../utils/path'
import { ChevronLeftIcon, ReaderIcon, StarIcon, FolderIcon } from '../components/common/Icon'
import { useReadingProgress } from '../hooks/useReadingProgress'
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

function AlbumView({ detail, onBack }: { detail: AlbumDetail; onBack: () => void }) {
  const navigate = useNavigate()
  const [gridSize, setGridSize] = useState<'sm' | 'md' | 'lg'>('md')
  const pushToast = useUIStore((s) => s.pushToast)
  const { data: progress } = useReadingProgress(detail.path)
  const startIndex = progress && progress.index > 0 && progress.index < detail.imageFiles.length
    ? progress.index
    : 0

  const openViewer = (idx: number) => {
    // 仅传 path/index/name，图片列表由 Viewer 端点拉取（避免 URL 超长）
    const qs = new URLSearchParams({
      path: detail.path,
      index: String(idx),
      name: detail.name,
    })
    navigate(`/viewer?${qs.toString()}`)
  }

  if (!detail.imageFiles.length) {
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
            <h1 className="font-display text-2xl font-semibold tracking-tight truncate">
              {detail.name}
            </h1>
            <div className="text-sm text-fg-muted mt-1.5">
              {detail.author && <span className="mr-3">{detail.author}</span>}
              <span className="tabular-nums">{detail.imageCount} 张</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center border border-border-faint rounded-md overflow-hidden text-xs">
              {(['sm', 'md', 'lg'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setGridSize(k)}
                  className={`h-8 px-2.5 transition-colors ${
                    gridSize === k
                      ? 'bg-bg-subtle text-fg'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                  title={k === 'sm' ? '密集' : k === 'md' ? '标准' : '宽松'}
                >
                  {k === 'sm' ? 'S' : k === 'md' ? 'M' : 'L'}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                openViewer(startIndex)
                pushToast({ kind: 'info', message: '开始浏览' })
              }}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors text-xs"
            >
              <ReaderIcon size={12} />
              <span>{progress && progress.index > 0 ? `继续 (${progress.index + 1})` : '打开'}</span>
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div className={`grid ${gridCls} gap-2 px-6 lg:px-10 pb-10`}>
          {detail.imageFiles.map((img, i) => {
            const isCurrent = progress && i === progress.index
            const isPast = progress && i < progress.index
            return (
              <button
                key={img}
                onClick={() => openViewer(i)}
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

export function buildImageUrl(absPath: string): string {
  return imageUrl(absPath)
}
