import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { thumbUrl } from '../../api/thumbs'
import { StarIcon, FolderIcon, ReaderIcon, RewindIcon, CheckIcon, ClockIcon, ArrowUpRightIcon } from '../common/Icon'
import HoverPreview from '../common/HoverPreview'
import type { ViewMode } from '../../store/uiStore'
import { timeAgo } from '../../utils/date'

export type CardVariant = 'album' | 'collection' | 'smart'
export type CardBadge = 'rewind' // 重温：30 天以上没看

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
  // 上次阅读时间（ISO），用于悬停预览的「上次 X」展示
  lastSeenAt?: string | null
  // 角标：当前只支持重温；未来可扩展
  badge?: CardBadge
}

interface Props {
  data: CardData
  variant?: ViewMode
  /** 显示「上次 X · 看到 Y/Z」行（仅 Recents 列表需要）。 */
  showLastSeen?: boolean
}

// 通用卡片：网格（默认 3:4 封面）/ 列表（横向缩略图 + 元数据）。
// 设计：
//  - 不画死板边框；hover 时给 cover 细微的明度变化 + 上浮
//  - 标题短截断 2 行；副标题只 1 行
//  - 阅读进度以底部细线 + 数字显示
//  - 智能集合有专属角标
//  - showLastSeen=true 时在标题下加一行「上次 X · 看到 Y/Z」
export default function AlbumCard({ data, variant = 'grid', showLastSeen }: Props) {
  if (variant === 'list') return <ListCard data={data} showLastSeen={showLastSeen} />
  return <GridCard data={data} showLastSeen={showLastSeen} />
}

function GridCard({ data, showLastSeen }: { data: CardData; showLastSeen?: boolean }) {
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)
  // 悬停预览状态
  const [previewOn, setPreviewOn] = useState(false)
  const [previewRect, setPreviewRect] = useState<DOMRect | null>(null)
  const previewTimer = useRef<number | null>(null)
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
  // 已读完：走到最后一页或仅差一页（最后一页常常是 endcard，差 1 也算读完了）
  const isFinished =
    !!data.progress &&
    data.progress.total > 0 &&
    data.progress.index >= data.progress.total - 1

  // 悬停预览：350ms 后弹出，移出卡片或预览延迟 150ms 关闭。
  // （延迟是为了让用户能从卡片顺利移到预览上，预览是 portal 元素，
  //   鼠标在 card→preview 的过渡中会先触发 card mouseleave。）
  // 触摸设备不启用（pointer: coarse 才挂监听）。
  const closeTimer = useRef<number | null>(null)
  const onEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (window.matchMedia('(pointer: coarse)').matches) return
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    const target = e.currentTarget
    previewTimer.current = window.setTimeout(() => {
      setPreviewRect(target.getBoundingClientRect())
      setPreviewOn(true)
    }, 350)
  }
  const onLeave = () => {
    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current)
      previewTimer.current = null
    }
    // 延迟关闭：给用户时间移到预览上
    closeTimer.current = window.setTimeout(() => {
      setPreviewOn(false)
      closeTimer.current = null
    }, 150)
  }
  // 卸载时清理 timer
  useEffect(() => {
    return () => {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current)
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    }
  }, [])

  return (
    <div
      ref={ref}
      role="link"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={onKey}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="group block cursor-pointer focus:outline-none"
    >
      <div className="relative aspect-[3/4] bg-bg-subtle rounded-lg overflow-hidden border border-border lift-card shadow-xs group-hover:shadow-lg group-hover:border-border-strong">
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

        {/* 底部暗化蒙版（hover 时让「进入」提示更清晰） */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

        {/* 「进入」提示 — hover 时从右下角淡入 */}
        <div
          className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 px-2 h-6 rounded-full bg-bg-elevated/90 backdrop-blur text-fg text-[10px] font-medium shadow-sm opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 ease-out"
          aria-hidden
        >
          <span>进入</span>
          <ArrowUpRightIcon size={10} />
        </div>

        {/* 收藏角标 */}
        {data.isFavorite && (
          <div className="absolute top-2 right-2 bg-bg-elevated/90 backdrop-blur rounded-full p-1 shadow-sm">
            <StarIcon size={11} className="text-warning" filled />
          </div>
        )}

        {/* 智能集合标记 / 重温角标 / 集合角标（同一位置，优先级：rewind > collection > smart） */}
        {data.badge === 'rewind' ? (
          <div className="absolute top-2 left-2 inline-flex items-center gap-1 bg-bg-elevated/95 backdrop-blur text-fg-muted text-[10px] font-medium px-1.5 py-0.5 rounded-md border border-border-faint shadow-xs">
            <RewindIcon size={10} className="text-accent" />
            <span>重温</span>
          </div>
        ) : data.variant === 'collection' ? (
          <div className="absolute top-2 left-2 bg-bg-elevated/90 backdrop-blur text-fg-muted text-[10px] font-medium px-1.5 py-0.5 rounded-md">
            <FolderIcon size={10} className="inline -mt-0.5 mr-0.5" />
            集合
          </div>
        ) : data.variant === 'smart' ? (
          <div className="absolute top-2 left-2 bg-accent text-accent-contrast text-[10px] font-medium px-1.5 py-0.5 rounded-md">
            标签
          </div>
        ) : null}

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

        {/* 已读：右下角徽章，封面略微提亮（叠在 cover 上时通过 mix-blend 强可读） */}
        {isFinished && data.variant === 'album' && (
          <div
            className="absolute bottom-2 right-2 inline-flex items-center gap-1 bg-success/95 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-md shadow-sm"
            title="已读完"
          >
            <CheckIcon size={10} />
            <span>已读</span>
          </div>
        )}
      </div>

      <div className="pt-3 pb-1">
        <div
          className="text-[13px] font-medium text-fg truncate-2 leading-snug transition-colors group-hover:text-accent"
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
        {showLastSeen && data.lastSeenAt && (
          <div
            className="text-[11px] text-fg-subtle mt-0.5 tabular-nums flex items-center gap-1.5 truncate"
            title={`上次 ${timeAgo(data.lastSeenAt)}`}
          >
            <ClockIcon size={10} className="shrink-0 text-fg-subtle/70" />
            {data.progress && data.progress.total > 0 && data.progress.index > 0 && (
              <>
                <span>
                  看到 {data.progress.index + 1} / {data.progress.total}
                </span>
                <span className="text-fg-subtle/40">·</span>
              </>
            )}
            <span>上次 {timeAgo(data.lastSeenAt)}</span>
          </div>
        )}
      </div>
      {/* 悬停预览（仅相册/合集；触摸设备不启用） */}
      {previewOn && previewRect && data.variant !== 'smart' && (
        <HoverPreview
          data={data}
          anchorRect={previewRect}
          lastSeenAt={data.lastSeenAt}
          onPointerEnter={() => {
            // 鼠标进入预览时取消正在等待的关闭 timer
            if (closeTimer.current !== null) {
              window.clearTimeout(closeTimer.current)
              closeTimer.current = null
            }
          }}
          onPointerLeave={onLeave}
        />
      )}
    </div>
  )
}

function ListCard({ data, showLastSeen }: { data: CardData; showLastSeen?: boolean }) {
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
  const isFinished =
    !!data.progress &&
    data.progress.total > 0 &&
    data.progress.index >= data.progress.total - 1

  return (
    <div
      ref={ref}
      role="link"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={onKey}
      className="group flex items-center gap-4 py-2.5 px-2.5 -mx-2.5 rounded-md hover:bg-bg-subtle transition-colors cursor-pointer focus:outline-none"
    >
      <div className="relative w-12 h-16 rounded bg-bg-subtle overflow-hidden shrink-0 border border-border shadow-xs">
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
        {isFinished && data.variant === 'album' && (
          <div
            className="absolute -bottom-1 -right-1 bg-success text-white rounded-full p-0.5 shadow-sm"
            title="已读完"
          >
            <CheckIcon size={9} />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-fg truncate flex items-center gap-1.5">
          <span className="truncate">{data.title}</span>
          {isFinished && data.variant === 'album' && (
            <span className="inline-flex items-center gap-0.5 text-success text-[10px] font-medium shrink-0">
              <CheckIcon size={10} />
              <span>已读</span>
            </span>
          )}
        </div>
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
              {data.progress!.index + 1} / {data.progress!.total}
            </span>
          </div>
        )}
        {showLastSeen && data.lastSeenAt && (
          <div className="text-[10px] text-fg-subtle mt-1 inline-flex items-center gap-1">
            <ClockIcon size={10} className="shrink-0 text-fg-subtle/70" />
            <span>上次 {timeAgo(data.lastSeenAt)}</span>
          </div>
        )}
      </div>

      <div className="text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity pr-1">
        <span className="text-xs">›</span>
      </div>
    </div>
  )
}
