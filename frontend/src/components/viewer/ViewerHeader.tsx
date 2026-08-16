import {
  ChevronLeftIcon,
  ChevronRightIcon,
  StarIcon,
  FullscreenIcon,
  InfoIcon,
  MoreHorizontalIcon,
  KeyboardIcon,
} from '../common/Icon'
import Popover, { PopoverItem, PopoverSeparator, PopoverLabel } from '../common/Popover'
import { useViewerStore } from '../../store/viewerStore'

interface Props {
  name: string
  index: number
  total: number
  isFavorite: boolean
  onBack: () => void
  onToggleFavorite: () => void
  onToggleInfo: () => void
  onToggleHelp: () => void
  onPrev: () => void
  onNext: () => void
}

// 查看器顶部常驻条：极简 — 返回 / 名称 / 页码 / 收藏 / 全屏 / 菜单
//
// 设计要点：
// - 始终可见（不被 chromeVisible 影响）
// - glass 半透明，沉浸但不抢戏
// - 暗色背景下用浅色文字；hover 用白色
// - 菜单里收纳：图片信息 / 快捷键帮助 / 上一本 / 下一本
export default function ViewerHeader({
  name,
  index,
  total,
  isFavorite,
  onBack,
  onToggleFavorite,
  onToggleInfo,
  onToggleHelp,
  onPrev,
  onNext,
}: Props) {
  const mode = useViewerStore((s) => s.mode)
  const setIndex = useViewerStore((s) => s.setIndex)
  const toggleFullscreen = useViewerStore((s) => s.toggleFullscreen)

  // 双页模式显示「L-R / total」；否则「N / total」
  const counterText = (() => {
    if (mode === 'double') {
      const hi = Math.min(index + 2, total)
      return `${index + 1}–${hi} / ${total}`
    }
    return `${index + 1} / ${total}`
  })()

  // 跳到首/尾（菜单里的快捷入口）
  const jumpToEnd = () => setIndex(Math.max(0, total - 1))

  return (
    <header
      className="absolute top-0 inset-x-0 z-20 h-11 flex items-center gap-1.5 px-2 sm:px-3 text-white/85"
      style={{
        background:
          'linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))',
      }}
    >
      <button
        onClick={onBack}
        title="返回 (Esc)"
        className="inline-flex items-center gap-1 h-7 px-2 rounded text-[12px] hover:bg-white/10 transition-colors"
      >
        <ChevronLeftIcon size={13} />
        <span className="hidden sm:inline">返回</span>
      </button>

      <h1 className="min-w-0 flex-1 flex items-center gap-2 sm:gap-3 ml-1">
        <span className="truncate text-[13px] font-medium text-white">{name}</span>
        <span className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] text-white/45 shrink-0">
          ·
        </span>
        <span className="text-[11px] tabular-nums text-white/65 shrink-0">{counterText}</span>
      </h1>

      {/* 上一张 / 下一张：常驻小按钮，沉浸模式不挡住图片 */}
      <div className="hidden md:flex items-center gap-0.5">
        <HeaderIconButton onClick={onPrev} disabled={index <= 0} title="上一张 (←)">
          <ChevronLeftIcon size={13} />
        </HeaderIconButton>
        <HeaderIconButton onClick={onNext} disabled={index >= total - 1} title="下一张 (→)">
          <ChevronRightIcon size={13} />
        </HeaderIconButton>
      </div>

      <HeaderIconButton
        onClick={onToggleFavorite}
        active={isFavorite}
        title={isFavorite ? '取消收藏 (S)' : '加入收藏 (S)'}
      >
        <StarIcon size={13} filled={isFavorite} className={isFavorite ? 'text-amber-300' : ''} />
      </HeaderIconButton>

      <HeaderIconButton
        onClick={toggleFullscreen}
        title="全屏 (F11)"
        hideOnMobile
      >
        <FullscreenIcon size={13} />
      </HeaderIconButton>

      <Popover
        align="end"
        trigger={
          <HeaderIconButton title="更多">
            <MoreHorizontalIcon size={14} />
          </HeaderIconButton>
        }
      >
        <PopoverLabel>阅读</PopoverLabel>
        <PopoverItem onClick={onToggleInfo}>
          <InfoIcon size={12} />
          <span>图片信息</span>
          <span className="ml-auto text-[10px] text-fg-subtle">I</span>
        </PopoverItem>
        <PopoverItem onClick={onToggleHelp}>
          <KeyboardIcon size={12} />
          <span>快捷键</span>
          <span className="ml-auto text-[10px] text-fg-subtle">?</span>
        </PopoverItem>
        <PopoverSeparator />
        <PopoverLabel>跳转</PopoverLabel>
        <PopoverItem onClick={() => setIndex(0)}>
          <span>第一张</span>
          <span className="ml-auto text-[10px] text-fg-subtle">Home</span>
        </PopoverItem>
        <PopoverItem onClick={jumpToEnd}>
          <span>最后张</span>
          <span className="ml-auto text-[10px] text-fg-subtle">End</span>
        </PopoverItem>
      </Popover>
    </header>
  )
}

function HeaderIconButton({
  children,
  onClick,
  disabled,
  title,
  active,
  hideOnMobile,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  active?: boolean
  hideOnMobile?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center h-7 w-7 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        hideOnMobile ? 'hidden sm:inline-flex' : ''
      } ${
        active
          ? 'bg-white/15 text-white'
          : 'text-white/75 hover:text-white hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}
