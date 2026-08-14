import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useLibraryStore } from '../store/libraryStore'
import { useSearchStore } from '../store/searchStore'
import { useFavorites } from '../hooks/useFavorites'
import { historyApi } from '../api/prefs'
import { thumbUrl } from '../api/thumbs'
import { imageUrl } from '../api/images'
import type { CardData } from '../components/album/AlbumGrid'
import AlbumGrid from '../components/album/AlbumGrid'
import EmptyState from '../components/common/EmptyState'
import { albumsApi } from '../api/albums'
import { decodeFavPath } from '../utils/path'
import { ChevronLeftIcon, ReaderIcon } from '../components/common/Icon'

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
//   - 缺数据时给出明确引导（重新扫描）
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
  const { add: addFav } = useFavorites()

  // 启动时拉一次缓存
  useEffect(() => {
    if (!result) loadFromBackend()
  }, [result, loadFromBackend])

  // 从缓存推导详情（避免重复请求）
  const localDetail = useMemo<Detail | null>(() => {
    if (!result) return null
    if (isSmart) {
      const sc = result.smartCollections.find((s) => s.author === realPath)
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
    // 先查顶层 albums
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
    const coll = result.collections.find((c) => c.path === realPath)
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

  // 单相册缺图片列表时，请求后端详情
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

  // 触发最近访问
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
        title="尚未扫描漫画库"
        description="回到主页点击「扫描」加载漫画库。"
        action={
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors text-sm"
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
        title="找不到此相册"
        description={`路径: ${realPath}`}
        action={
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 rounded-md border border-border hover:bg-bg-subtle text-sm"
          >
            返回主页
          </button>
        }
      />
    )
  }

  if (detail.type === 'collection' || detail.type === 'smartCollection') {
    return (
      <CollectionView
        detail={detail}
        query={query}
        sortBy={sortBy}
        onBack={() => navigate(-1)}
        onToggleFav={() => {
          if (detail.type === 'smartCollection') {
            addFav(`smart:${detail.author}`).catch(() => {})
          }
        }}
      />
    )
  }

  return <AlbumView detail={detail} onBack={() => navigate(-1)} />
}

// ============== 相册（图片网格 + 进入查看器） ==============
function AlbumView({ detail, onBack }: { detail: AlbumDetail; onBack: () => void }) {
  const navigate = useNavigate()
  const [gridSize, setGridSize] = useState<'sm' | 'md' | 'lg'>('md')

  const openViewer = (idx: number) => {
    const qs = new URLSearchParams({
      images: encodeURIComponent(JSON.stringify(detail.imageFiles)),
      index: String(idx),
      name: detail.name,
      album: detail.path,
    })
    navigate(`/viewer?${qs.toString()}`)
  }

  if (!detail.imageFiles.length) {
    return (
      <div className="p-6">
        <EmptyState
          title="该相册暂无图片"
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
      <AlbumHeader
        name={detail.name}
        subtitle={detail.author}
        count={detail.imageCount}
        controls={
          <div className="flex items-center gap-1 text-xs">
            {(['sm', 'md', 'lg'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setGridSize(k)}
                className={`px-2 py-1 rounded border ${
                  gridSize === k
                    ? 'bg-accent text-accent-fg border-accent'
                    : 'border-border hover:bg-bg-subtle'
                }`}
              >
                {k === 'sm' ? '小' : k === 'md' ? '中' : '大'}
              </button>
            ))}
          </div>
        }
        onBack={onBack}
        onAction={() => openViewer(0)}
        actionLabel="开始阅读"
      />
      <div className="flex-1 overflow-auto">
        <div className={`grid ${gridCls} gap-2 p-4`}>
          {detail.imageFiles.map((img, i) => (
            <button
              key={img}
              onClick={() => openViewer(i)}
              className="group relative aspect-[3/4] bg-bg-subtle rounded overflow-hidden border border-border hover:border-border-strong lift"
              title={`第 ${i + 1} 页`}
            >
              <img
                src={thumbUrl(img)}
                alt={`page ${i + 1}`}
                loading="lazy"
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-1 left-1 text-[10px] bg-bg-elevated/90 backdrop-blur px-1.5 py-0.5 rounded text-fg-muted tabular-nums">
                {i + 1}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============== 集合 / 智能集合（嵌套相册列表） ==============
function CollectionView({
  detail,
  query,
  sortBy,
  onBack,
  onToggleFav,
}: {
  detail: CollectionDetail | SmartDetail
  query: string
  sortBy: 'name' | 'count' | 'recent'
  onBack: () => void
  onToggleFav: () => void
}) {
  const isSmart = detail.type === 'smartCollection'
  const title = isSmart ? detail.author : detail.name
  const subtitle = isSmart
    ? `智能集合 · ${detail.albumCount} 卷`
    : `集合 · ${detail.albumCount} 卷`

  const filtered = useMemo(() => {
    const items = detail.albums
      .filter((a) => !query || a.name.toLowerCase().includes(query.toLowerCase()))
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

  return (
    <div className="flex flex-col h-full">
      <AlbumHeader
        name={title}
        subtitle={subtitle}
        count={detail.albumCount}
        onBack={onBack}
        onAction={onToggleFav}
        actionLabel="收藏"
        controls={null}
      />
      <div className="flex-1 overflow-auto">
        {cards.length === 0 ? (
          <EmptyState title="无匹配结果" description="试试修改搜索条件或排序。" />
        ) : (
          <AlbumGrid items={cards} />
        )}
      </div>
    </div>
  )
}

// ============== 相册/集合头部（统一头） ==============
function AlbumHeader({
  name,
  subtitle,
  count,
  controls,
  onBack,
  onAction,
  actionLabel,
}: {
  name: string
  subtitle?: string
  count: number
  controls: React.ReactNode
  onBack: () => void
  onAction: () => void
  actionLabel: string
}) {
  return (
    <div className="px-6 pt-6 pb-4 border-b border-border bg-bg-elevated">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-3"
      >
        <ChevronLeftIcon size={14} />
        <span>返回</span>
      </button>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight truncate">
            {name}
          </h1>
          <div className="text-sm text-fg-muted mt-1">
            {subtitle && <span className="mr-3">{subtitle}</span>}
            <span className="tabular-nums">{count} 张</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {controls}
          <button
            onClick={onAction}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors text-sm"
          >
            <ReaderIcon size={14} />
            <span>{actionLabel}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// 兼容旧 Viewer：从 ?images=<json>&index=<n>&name=&album=
// 这里保留一个简单 export，方便 Viewer 仍使用 query 参数工作。
export function buildImageUrl(absPath: string): string {
  return imageUrl(absPath)
}
