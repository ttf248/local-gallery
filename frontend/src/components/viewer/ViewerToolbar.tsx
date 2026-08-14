import { useViewerStore } from '../../store/viewerStore'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  MinusIcon,
  RotateIcon,
  PlayIcon,
  PauseIcon,
  FullscreenIcon,
  InfoIcon,
  HelpIcon,
} from '../common/Icon'

interface Props {
  total: number
  onPrev: () => void
  onNext: () => void
  showInfo?: boolean
  onToggleInfo?: () => void
  onToggleHelp?: () => void
}

// 查看器工具栏：左 返回 / 中 进度 / 右 操作。
// 设计：底栏更克制，操作按钮紧凑成两组。
export default function ViewerToolbar({
  total,
  onPrev,
  onNext,
  showInfo,
  onToggleInfo,
  onToggleHelp,
}: Props) {
  const navigate = useNavigate()
  const index = useViewerStore((s) => s.index)
  const zoom = useViewerStore((s) => s.zoom)
  const rotation = useViewerStore((s) => s.rotation)
  const slideshow = useViewerStore((s) => s.slideshow)
  const slideshowInterval = useViewerStore((s) => s.slideshowInterval)
  const zoomIn = useViewerStore((s) => s.zoomIn)
  const zoomOut = useViewerStore((s) => s.zoomOut)
  const zoomReset = useViewerStore((s) => s.zoomReset)
  const rotate = useViewerStore((s) => s.rotate)
  const toggleSlideshow = useViewerStore((s) => s.toggleSlideshow)
  const setSlideshowInterval = useViewerStore((s) => s.setSlideshowInterval)
  const toggleFullscreen = useViewerStore((s) => s.toggleFullscreen)

  const pct = total > 0 && index >= 0 ? Math.round(((index + 1) / total) * 100) : 0

  return (
    <header className="h-12 flex items-center gap-2 px-3 border-b border-border-faint bg-bg-elevated/85 backdrop-blur text-sm">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 h-8 px-2 rounded-md text-fg-muted hover:text-fg hover:bg-bg-subtle text-xs transition-colors"
        title="返回"
      >
        <ChevronLeftIcon size={13} />
        <span>返回</span>
      </button>

      <div className="flex-1 flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-1">
          <IconButton onClick={onPrev} disabled={index <= 0} title="上一张 (←)">
            <ChevronLeftIcon size={14} />
          </IconButton>
          <IconButton onClick={onNext} disabled={index >= total - 1} title="下一张 (→)">
            <ChevronRightIcon size={14} />
          </IconButton>
        </div>
        <div className="flex-1 max-w-[280px] flex items-center gap-2">
          <div className="flex-1 h-0.5 bg-bg-strong rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] text-fg-muted tabular-nums shrink-0">
            {index >= 0 ? index + 1 : '—'} / {total}
          </span>
        </div>
      </div>

      <div className="w-px h-5 bg-border-faint mx-1" />
      <div className="flex items-center gap-0.5">
        <IconButton onClick={zoomOut} title="缩小 (-)">
          <MinusIcon size={13} />
        </IconButton>
        <button
          onClick={zoomReset}
          className="h-7 px-1.5 rounded text-[11px] hover:bg-bg-subtle tabular-nums min-w-[42px] transition-colors"
          title="重置 (0)"
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton onClick={zoomIn} title="放大 (+)">
          <PlusIcon size={13} />
        </IconButton>
        <IconButton onClick={() => rotate(90)} title="旋转 (R)">
          <span className="inline-flex items-center gap-1 text-[11px]">
            <RotateIcon size={12} />
            <span className="tabular-nums">{rotation}°</span>
          </span>
        </IconButton>
      </div>
      <div className="w-px h-5 bg-border-faint mx-1" />
      <div className="flex items-center gap-0.5">
        <IconButton
          onClick={toggleSlideshow}
          active={slideshow}
          title="幻灯片 (Space)"
        >
          {slideshow ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
        </IconButton>
        <select
          value={slideshowInterval}
          onChange={(e) => setSlideshowInterval(Number(e.target.value))}
          className="bg-transparent text-[11px] text-fg-muted border border-border-faint rounded px-1.5 h-7 outline-none"
        >
          <option value={1000}>1s</option>
          <option value={2000}>2s</option>
          <option value={3000}>3s</option>
          <option value={5000}>5s</option>
        </select>
        <IconButton onClick={toggleFullscreen} title="全屏 (F11)">
          <FullscreenIcon size={13} />
        </IconButton>
        {onToggleInfo && (
          <IconButton
            onClick={onToggleInfo}
            active={showInfo}
            title="图片信息 (I)"
          >
            <InfoIcon size={13} />
          </IconButton>
        )}
        {onToggleHelp && (
          <IconButton onClick={onToggleHelp} title="帮助 (Ctrl+/)">
            <HelpIcon size={13} />
          </IconButton>
        )}
      </div>
    </header>
  )
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
  active,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center h-7 px-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-bg-subtle text-fg' : 'text-fg-muted hover:text-fg hover:bg-bg-subtle'
      }`}
    >
      {children}
    </button>
  )
}
