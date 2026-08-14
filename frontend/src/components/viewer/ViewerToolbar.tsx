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

  return (
    <header className="h-12 flex items-center gap-1 px-3 border-b border-border bg-bg-elevated text-sm">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-fg-muted hover:text-fg hover:bg-bg-subtle text-xs"
        title="返回"
      >
        <ChevronLeftIcon size={14} />
        <span>返回</span>
      </button>
      <div className="flex-1 text-center text-fg-muted tabular-nums text-xs">
        {index >= 0 ? `${index + 1} / ${total}` : '— / —'}
      </div>
      <div className="flex items-center gap-0.5">
        <IconButton onClick={onPrev} disabled={index <= 0} title="上一张 (←)">
          <ChevronLeftIcon size={15} />
        </IconButton>
        <IconButton onClick={onNext} disabled={index >= total - 1} title="下一张 (→)">
          <ChevronRightIcon size={15} />
        </IconButton>
      </div>
      <div className="w-px h-5 bg-border mx-2" />
      <div className="flex items-center gap-0.5">
        <IconButton onClick={zoomOut} title="缩小 (-)">
          <MinusIcon size={14} />
        </IconButton>
        <button
          onClick={zoomReset}
          className="px-2 py-1 rounded text-xs hover:bg-bg-subtle tabular-nums min-w-[48px]"
          title="重置 (0)"
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton onClick={zoomIn} title="放大 (+)">
          <PlusIcon size={14} />
        </IconButton>
        <IconButton onClick={() => rotate(90)} title="旋转 (R)">
          <span className="inline-flex items-center gap-1 text-xs">
            <RotateIcon size={13} />
            <span className="tabular-nums">{rotation}°</span>
          </span>
        </IconButton>
      </div>
      <div className="w-px h-5 bg-border mx-2" />
      <div className="flex items-center gap-0.5">
        <IconButton
          onClick={toggleSlideshow}
          active={slideshow}
          title="幻灯片 (Space)"
        >
          {slideshow ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
        </IconButton>
        <select
          value={slideshowInterval}
          onChange={(e) => setSlideshowInterval(Number(e.target.value))}
          className="bg-bg text-fg border border-border rounded px-1.5 py-0.5 text-xs"
        >
          <option value={1000}>1s</option>
          <option value={2000}>2s</option>
          <option value={3000}>3s</option>
          <option value={5000}>5s</option>
        </select>
        <IconButton onClick={toggleFullscreen} title="全屏 (F11)">
          <FullscreenIcon size={14} />
        </IconButton>
        {onToggleInfo && (
          <IconButton
            onClick={onToggleInfo}
            active={showInfo}
            title="图片信息 (I)"
          >
            <InfoIcon size={14} />
          </IconButton>
        )}
        {onToggleHelp && (
          <IconButton onClick={onToggleHelp} title="帮助 (Ctrl+/)">
            <HelpIcon size={14} />
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
      className={`inline-flex items-center justify-center px-2 py-1 rounded hover:bg-bg-subtle transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-bg-subtle text-accent' : 'text-fg-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}
