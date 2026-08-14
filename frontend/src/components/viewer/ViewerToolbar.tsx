import { useViewerStore } from '../../store/viewerStore'
import { useNavigate } from 'react-router-dom'

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
  const {
    index,
    zoom,
    rotation,
    slideshow,
    slideshowInterval,
    zoomIn,
    zoomOut,
    zoomReset,
    rotate,
    toggleSlideshow,
    setSlideshowInterval,
    toggleFullscreen,
  } = useViewerStore()

  return (
    <header className="h-10 flex items-center gap-2 px-3 border-b border-border bg-bg-elevated text-sm">
      <button
        onClick={() => navigate(-1)}
        className="px-2 py-1 text-fg-muted hover:text-fg"
      >
        ← 返回
      </button>
      <div className="flex-1 text-center text-fg-muted">
        {index >= 0 ? `${index + 1} / ${total}` : '— / —'}
      </div>
      <button
        onClick={onPrev}
        disabled={index <= 0}
        className="px-2 py-1 rounded hover:bg-bg-subtle disabled:opacity-30"
        title="上一张 (←)"
      >
        ◀
      </button>
      <button
        onClick={onNext}
        disabled={index >= total - 1}
        className="px-2 py-1 rounded hover:bg-bg-subtle disabled:opacity-30"
        title="下一张 (→)"
      >
        ▶
      </button>
      <div className="w-px h-5 bg-border mx-1" />
      <button onClick={zoomOut} className="px-2 py-1 rounded hover:bg-bg-subtle" title="缩小 (-)">
        −
      </button>
      <button onClick={zoomReset} className="px-2 py-1 rounded hover:bg-bg-subtle" title="重置 (0)">
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={zoomIn} className="px-2 py-1 rounded hover:bg-bg-subtle" title="放大 (+)">
        +
      </button>
      <button onClick={() => rotate(90)} className="px-2 py-1 rounded hover:bg-bg-subtle" title="旋转 (R)">
        ↻ {rotation}°
      </button>
      <div className="w-px h-5 bg-border mx-1" />
      <button
        onClick={toggleSlideshow}
        className={`px-2 py-1 rounded hover:bg-bg-subtle ${slideshow ? 'text-accent' : ''}`}
        title="幻灯片 (Space)"
      >
        {slideshow ? '⏸' : '▶'}
      </button>
      <select
        value={slideshowInterval}
        onChange={(e) => setSlideshowInterval(Number(e.target.value))}
        className="bg-bg text-fg border border-border rounded px-1 text-xs"
      >
        <option value={1000}>1s</option>
        <option value={2000}>2s</option>
        <option value={3000}>3s</option>
        <option value={5000}>5s</option>
      </select>
      <button onClick={toggleFullscreen} className="px-2 py-1 rounded hover:bg-bg-subtle" title="全屏 (F11)">
        ⛶
      </button>
      {onToggleInfo && (
        <button
          onClick={onToggleInfo}
          className={`px-2 py-1 rounded hover:bg-bg-subtle ${showInfo ? 'text-accent' : ''}`}
          title="图片信息 (I)"
        >
          ℹ
        </button>
      )}
      {onToggleHelp && (
        <button
          onClick={onToggleHelp}
          className="px-2 py-1 rounded hover:bg-bg-subtle"
          title="帮助 (Ctrl+/)"
        >
          ?
        </button>
      )}
    </header>
  )
}
