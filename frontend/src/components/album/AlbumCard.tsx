import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { thumbUrl } from '../../api/thumbs'
import { StarIcon, FolderIcon, ReaderIcon } from '../common/Icon'
import type { ViewMode } from '../../store/uiStore'

export type CardVariant = 'album' | 'collection' | 'smart'

export interface CardData {
  id: string
  variant: CardVariant
  title: string
  subtitle?: string
  count: number
  coverPath: string
  to: string
  isFavorite?: boolean
  // 阅读进度：index + total，用于显示百分比与定位条
  progress?: { index: number; total: number }
}

interface Props {
  data: CardData
  variant?: ViewMode
}

// 通用卡片：网格（默认 3:4 封面）/ 列表（横向缩略图 + 元数据）。
// 设计：
//  - 不画死板边框；hover 时给 cover 细微的明度变化 + 上浮
//  - 标题短截断 2 行；副标题只 1 行
//  - 阅读进度以底部细线 + 数字显示
//  - 智能集合有专属角标
export default function AlbumCard({ data, variant = 'grid' }: Props) {
  if (variant === 'list') return <ListCard data={data} />
  return <GridCard data={data} />
}

function GridCard({ data }: { data: CardData }) {
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!ref.current) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true)
            io.disconnect()
            break
          }
        }
      },
      { rootMargin: '500px' },
    )
    io.observe(ref.current)
    return () => io.disconnect()
  }, [])

  const onActivate = () => navigate(data.to)
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onActivate()
    }
  }

  const progressPct =
    data.progress && data.progress.total > 0
      ? Math.min(100, Math.round((data.progress.index / Math.max(1, data.progress.total - 1)) * 100))
      : null

  return (
    <div
      ref={ref}
      role="link"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={onKey}
      className="group block cursor-pointer focus:outline-none"
    >
      <div className="relative aspect-[3/4] bg-bg-subtle rounded-lg overflow-hidden ring-1 ring-border-faint transition-shadow duration-200 group-hover:shadow-md group-hover:ring-border">
        {visible && data.coverPath && !imgError ? (
          <>
            <img
              src={thumbUrl(data.coverPath)}
              alt={data.title}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setImgError(true)}
              className={`w-full h-full object-cover transition-all duration-500 ease-out ${
                loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-[1.02]'
              } group-hover:scale-[1.03]`}
            />
            {!loaded && <div className="absolute inset-0 bg-bg-subtle animate-pulse" />}
          </>
        ) : (
          // 缩略图加载失败（HEIC 等不支持的格式）→ 显示占位
          <div className="absolute inset-0 flex items-center justify-center bg-bg-subtle text-fg-subtle">
            <FolderIcon size={28} />
          </div>
        )}

        {/* 顶部变暗蒙版（仅在 hover 时出现） */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/0 via-transparent to-black/0 opacity-0 group-hover:opacity-20 transition-opacity duration-300 pointer-events-none" />

        {/* 收藏角标 */}
        {data.isFavorite && (
          <div className="absolute top-2 right-2 bg-bg-elevated/90 backdrop-blur rounded-full p-1 shadow-sm">
            <StarIcon size={11} className="text-warning" filled />
          </div>
        )}

        {/* 智能集合标记 */}
        {data.variant === 'smart' && (
          <div className="absolute top-2 left-2 bg-accent text-accent-contrast text-[10px] font-medium px-1.5 py-0.5 rounded-md">
            作者
          </div>
        )}
        {data.variant === 'collection' && (
          <div className="absolute top-2 left-2 bg-bg-elevated/90 backdrop-blur text-fg-muted text-[10px] font-medium px-1.5 py-0.5 rounded-md">
            <FolderIcon size={10} className="inline -mt-0.5 mr-0.5" />
            集合
          </div>
        )}

        {/* 阅读进度 */}
        {progressPct !== null && progressPct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 px-2.5 py-2 bg-gradient-to-t from-black/55 to-transparent">
            <div className="flex items-center gap-1.5 text-white/95">
              <ReaderIcon size={11} className="shrink-0" />
              <span className="text-[10px] font-medium tabular-nums">{progressPct}%</span>
            </div>
            <div className="mt-1.5 h-0.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white/90"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="pt-3 pb-1">
        <div
          className="text-[13px] font-medium text-fg truncate-2 leading-snug"
          title={data.title}
        >
          {data.title}
        </div>
        <div className="text-[11px] text-fg-subtle mt-1 tabular-nums flex items-center gap-1.5">
          <span>
            {data.count} {data.variant === 'collection' ? '卷' : data.variant === 'smart' ? '卷' : '张'}
          </span>
          {data.subtitle && (
            <>
              <span className="text-fg-subtle/50">·</span>
              <span className="truncate">{data.subtitle}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ListCard({ data }: { data: CardData }) {
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!ref.current) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true)
            io.disconnect()
            break
          }
        }
      },
      { rootMargin: '500px' },
    )
    io.observe(ref.current)
    return () => io.disconnect()
  }, [])

  const onActivate = () => navigate(data.to)
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onActivate()
    }
  }

  const progressPct =
    data.progress && data.progress.total > 0
      ? Math.min(100, Math.round((data.progress.index / Math.max(1, data.progress.total - 1)) * 100))
      : null

  return (
    <div
      ref={ref}
      role="link"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={onKey}
      className="group flex items-center gap-4 py-2.5 px-2 -mx-2 rounded-md hover:bg-bg-subtle transition-colors cursor-pointer focus:outline-none"
    >
      <div className="relative w-12 h-16 rounded bg-bg-subtle overflow-hidden shrink-0 ring-1 ring-border-faint">
        {visible && data.coverPath && !imgError ? (
          <img
            src={thumbUrl(data.coverPath)}
            alt={data.title}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setImgError(true)}
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        ) : !visible || imgError ? (
          <div className="w-full h-full flex items-center justify-center text-fg-subtle">
            <FolderIcon size={16} />
          </div>
        ) : null}
        {!loaded && visible && !imgError && <div className="absolute inset-0 bg-bg-subtle animate-pulse" />}
        {data.isFavorite && (
          <div className="absolute -top-1 -right-1 bg-bg-elevated rounded-full p-0.5 shadow-sm">
            <StarIcon size={9} className="text-warning" filled />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-fg truncate">{data.title}</div>
        <div className="text-[11px] text-fg-subtle mt-0.5 flex items-center gap-2">
          {data.subtitle && <span className="truncate">{data.subtitle}</span>}
          <span className="tabular-nums shrink-0">
            {data.count} {data.variant === 'collection' ? '卷' : data.variant === 'smart' ? '卷' : '张'}
          </span>
        </div>
        {progressPct !== null && progressPct > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-0.5 bg-bg-strong rounded-full overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-[10px] text-fg-subtle tabular-nums shrink-0">
              {progressPct}%
            </span>
          </div>
        )}
      </div>

      <div className="text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity pr-1">
        <span className="text-xs">›</span>
      </div>
    </div>
  )
}
