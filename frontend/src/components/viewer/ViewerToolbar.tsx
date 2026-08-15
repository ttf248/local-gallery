import { useViewerStore, type FitMode, type ReadDirection, type ReaderMode } from '../../store/viewerStore'
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
  SinglePageIcon,
  ScrollPageIcon,
  DoublePageIcon,
  FitIcon,
  FitWidthIcon,
  FitHeightIcon,
  OriginalSizeIcon,
  ArrowRightLineIcon,
  ArrowLeftLineIcon,
} from '../common/Icon'

interface Props {
  total: number
  onPrev: () => void
  onNext: () => void
  showInfo?: boolean
  onToggleInfo?: () => void
  onToggleHelp?: () => void
}

// 显示模式选项
const MODE_OPTIONS: { value: ReaderMode; label: string; icon: typeof SinglePageIcon }[] = [
  { value: 'single', label: '单张', icon: SinglePageIcon },
  { value: 'continuous', label: '连续', icon: ScrollPageIcon },
  { value: 'double', label: '并排', icon: DoublePageIcon },
]

// 适配选项
const FIT_OPTIONS: { value: FitMode; label: string; icon: typeof FitIcon }[] = [
  { value: 'fit', label: '适应', icon: FitIcon },
  { value: 'width', label: '按宽', icon: FitWidthIcon },
  { value: 'height', label: '按高', icon: FitHeightIcon },
  { value: 'original', label: '原始', icon: OriginalSizeIcon },
]

// 查看器工具栏：
// 左 返回 / 中 进度（连续模式改为已读 N）/ 右 显示模式 / 适配 / 方向 / 缩放 / 旋转 / 幻灯片 / 全屏 / 信息
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
  const mode = useViewerStore((s) => s.mode)
  const fit = useViewerStore((s) => s.fit)
  const direction = useViewerStore((s) => s.direction)
  const zoomIn = useViewerStore((s) => s.zoomIn)
  const zoomOut = useViewerStore((s) => s.zoomOut)
  const zoomReset = useViewerStore((s) => s.zoomReset)
  const rotate = useViewerStore((s) => s.rotate)
  const toggleSlideshow = useViewerStore((s) => s.toggleSlideshow)
  const setSlideshowInterval = useViewerStore((s) => s.setSlideshowInterval)
  const toggleFullscreen = useViewerStore((s) => s.toggleFullscreen)
  const setMode = useViewerStore((s) => s.setMode)
  const setFit = useViewerStore((s) => s.setFit)
  const setDirection = useViewerStore((s) => s.setDirection)

  const pct = total > 0 && index >= 0 ? Math.round(((index + 1) / total) * 100) : 0

  // 进度文字：单页/双页 1-based；连续 用「已读」前缀
  const counter = (() => {
    if (total === 0 || index < 0) return { left: '—', right: total }
    if (mode === 'double') {
      const hi = Math.min(index + 2, total)
      return { left: `${index + 1}–${hi}`, right: total }
    }
    return { left: `${index + 1}`, right: total }
  })()

  return (
    <header className="h-12 flex items-center gap-2 px-3 border-b border-border-faint bg-bg-elevated/85 backdrop-blur text-sm overflow-x-auto">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 h-8 px-2 rounded-md text-fg-muted hover:text-fg hover:bg-bg-subtle text-xs transition-colors shrink-0"
        title="返回"
      >
        <ChevronLeftIcon size={13} />
        <span>返回</span>
      </button>

      <div className="flex-1 flex items-center gap-2 min-w-0">
        {/* 单页 / 双页 模式显示上下页按钮；连续模式不显示 */}
        {mode !== 'continuous' && (
          <div className="flex items-center gap-1 shrink-0">
            <IconButton
              onClick={onPrev}
              disabled={index <= 0}
              title={`上一${mode === 'double' ? '对' : '张'} (←)`}
            >
              <ChevronLeftIcon size={14} />
            </IconButton>
            <IconButton
              onClick={onNext}
              disabled={index >= total - 1}
              title={`下一${mode === 'double' ? '对' : '张'} (→)`}
            >
              <ChevronRightIcon size={14} />
            </IconButton>
          </div>
        )}
        <div className="flex-1 max-w-[260px] flex items-center gap-2 min-w-0">
          <div className="flex-1 h-0.5 bg-bg-strong rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] text-fg-muted tabular-nums shrink-0">
            {counter.left} / {counter.right}
          </span>
        </div>
      </div>

      <Sep />
      {/* 阅读模式切换 */}
      <SegmentedPicker
        value={mode}
        options={MODE_OPTIONS}
        onChange={(v) => setMode(v as ReaderMode)}
        titlePrefix="模式"
      />
      <Sep />
      {/* 适配切换 */}
      <SegmentedPicker
        value={fit}
        options={FIT_OPTIONS}
        onChange={(v) => setFit(v as FitMode)}
        titlePrefix="适配"
      />
      <Sep />
      {/* 阅读方向：双页模式才有意义 */}
      {mode === 'double' && (
        <button
          onClick={() => setDirection(direction === 'ltr' ? 'rtl' : 'ltr')}
          className="inline-flex items-center justify-center h-7 px-1.5 rounded transition-colors text-fg-muted hover:text-fg hover:bg-bg-subtle shrink-0"
          title={`阅读方向 (L)：${direction === 'ltr' ? '从左到右' : '从右到左'}`}
        >
          {direction === 'ltr' ? <ArrowRightLineIcon size={13} /> : <ArrowLeftLineIcon size={13} />}
        </button>
      )}
      <Sep />
      {/* 缩放 */}
      <div className="flex items-center gap-0.5 shrink-0">
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
      <Sep />
      {/* 幻灯片 / 全屏 / 信息 / 帮助 */}
      <div className="flex items-center gap-0.5 shrink-0">
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
          <IconButton onClick={onToggleHelp} title="帮助 (?)">
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

function Sep() {
  return <div className="w-px h-5 bg-border-faint mx-0.5 shrink-0" />
}

interface SegmentItem {
  value: string
  label: string
  icon: React.ComponentType<{ size?: number | string }>
}

function SegmentedPicker({
  value,
  options,
  onChange,
  titlePrefix,
}: {
  value: string
  options: SegmentItem[]
  onChange: (v: string) => void
  titlePrefix: string
}) {
  return (
    <div className="inline-flex items-center border border-border-faint rounded-md overflow-hidden shrink-0">
      {options.map((o, i) => {
        const Icon = o.icon
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            title={`${titlePrefix}：${o.label}`}
            className={`inline-flex items-center justify-center h-7 w-7 transition-colors ${
              i > 0 ? 'border-l border-border-faint' : ''
            } ${active ? 'bg-bg-subtle text-fg' : 'text-fg-subtle hover:text-fg'}`}
          >
            <Icon size={13} />
          </button>
        )
      })}
    </div>
  )
}

// 抑制未使用导入告警：ReadDirection / direction 仍会出现在 props 类型上
export type _Direction = ReadDirection
