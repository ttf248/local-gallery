import { useRef, useLayoutEffect, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  StarIcon,
  FullscreenIcon,
  InfoIcon,
  MoreHorizontalIcon,
  KeyboardIcon,
  ImageIcon,
  RefreshIcon,
  ArrowRightLineIcon,
  ArrowLeftLineIcon,
  GridIcon,
  LibraryIcon,
  ReaderIcon,
} from "../../ui/icons";
import Popover, {
  PopoverItem,
  PopoverSeparator,
  PopoverLabel,
} from "../../ui/Popover";
import { useGalleryStore } from "../../store/galleryStore";
import { supportsFullscreen } from "../../utils/fullscreen";
import type { AppMode } from "../../api/library";

interface Props {
  onMenuChange?: (open: boolean) => void;
  fullscreen: () => void;
  name: string;
  /**
   * 图片阅读器 store 中的 0-based 页码。视频模式不复用这份状态。
   * 推荐在视频模式传 `itemIndex`；不传时回退到 `index`。
   */
  index: number;
  /**
   * 当前 item 在列表中的 0-based 索引（用于头部计数 + 翻页禁用判断）。
   * 视频模式下 Gallery.tsx 必须显式传这个，避免把视频项序号写入图片 store。
   */
  itemIndex?: number;
  total: number;
  isFavorite: boolean;
  onBack: () => void;
  onToggleFavorite: () => void;
  onToggleInfo: () => void;
  onToggleHelp: () => void;
  onOpenSettings?: () => void;
  /** 上一张 / 下一张。图片模式由底部工具条提供，这里只服务视频模式。 */
  onPrev: () => void;
  onNext: () => void;
  /** 上一本/下一本（来自当前列表）。可选：没有上下文时不显示。 */
  onPrevAlbum?: () => void;
  onNextAlbum?: () => void;
  /** 跳到列表首/尾（视频模式下需要走 URL 切视频，不能用 setIndex）。 */
  onJumpToFirst: () => void;
  onJumpToLast: () => void;
  /** 把当前图片/视频设为本相册的封面。 */
  onSetCover?: () => void;
  /** 清除本相册的自定义封面（回到扫描器默认）。 */
  onClearCover?: () => void;
  /** 当前相册是否已有自定义封面（决定 Popover 显示哪种文案）。 */
  hasCustomCover?: boolean;
  /** 打开目录（整本缩略图）。可选：不提供时不显示入口。 */
  onToggleOverview?: () => void;
  /**
   * 工作台切换。阅读器整屏脱离 AppShell，侧栏不可见，
   * 想换工作台只能从这里走——切模式意味着离开阅读器回到外壳。
   */
  workbenchMode?: AppMode;
  onOpenWorkbench?: (mode: AppMode) => void;
}

// 按阅读列的实际宽度收纳工作台、收藏和全屏。
export default function GalleryHeader({
  name,
  index,
  itemIndex,
  total,
  isFavorite,
  onBack,
  onToggleFavorite,
  onToggleInfo,
  onToggleHelp,
  onOpenSettings,
  onPrev,
  onNext,
  onPrevAlbum,
  onNextAlbum,
  onSetCover,
  onClearCover,
  hasCustomCover,
  onJumpToFirst,
  onJumpToLast,
  onToggleOverview,
  workbenchMode,
  onOpenWorkbench,
  onMenuChange,
  fullscreen,
}: Props) {
  const mode = useGalleryStore((s) => s.mode);
  const direction = useGalleryStore((s) => s.direction);
  const setDirection = useGalleryStore((s) => s.setDirection);
  const header = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = header.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      setNarrow(rect.width < 640);
      el.closest<HTMLElement>(".reader-shell")?.style.setProperty(
        "--reader-header-height",
        rect.height + "px",
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // 显示 / 翻页禁用都用 item index；未传时回退到 index（仅图库模式安全）
  const displayIndex = itemIndex !== undefined ? itemIndex : Math.floor(index);
  const isVideo = itemIndex !== undefined;

  // 双页模式显示「L-R / total」；否则「N / total」
  //
  // 卷末只剩一页时（页数是单数，最后一页没有搭档）写「N / total」，
  // 不写「N–N / total」：同一个数字写两遍读起来像少了一页。
  const counterText = (() => {
    if (!isVideo && mode === "double") {
      const hi = Math.min(displayIndex + 2, total);
      if (hi > displayIndex + 1) {
        return `${displayIndex + 1}–${hi} / ${total}`;
      }
    }
    return `${displayIndex + 1} / ${total}`;
  })();

  return (
    <header ref={header} className="reader-header">
      <div className="reader-header__group reader-header__group--main text-white/85">
        <button
          onClick={onBack}
          aria-label="返回"
          title="返回 (Esc)"
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-body transition-colors hover:bg-white/10"
        >
          <ChevronLeftIcon size={14} />
          <span className="hidden sm:inline">返回</span>
        </button>

        <h1
          title={name}
          className="flex min-w-0 flex-1 items-baseline gap-2.5 sm:gap-3"
        >
          <span className="truncate text-body font-medium text-white">
            {name}
          </span>
          <span className="shrink-0 text-caption tabular-nums text-white/70">
            {counterText}
          </span>
        </h1>
      </div>

      <div className="reader-header__group reader-header__group--actions text-white/85">
        {/* 工作台切换：阅读器没有侧栏，这里是唯一能换工作台的地方。
          切换意味着离开阅读器回到外壳，所以它是一个「打开某个库」的动作。 */}
        {!narrow && onOpenWorkbench && workbenchMode && (
          <Popover
            onOpenChange={onMenuChange}
            align="end"
            tone="reader"
            trigger={
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-caption text-white/75 transition-colors hover:bg-white/10"
                title="切换工作台"
              >
                <LibraryIcon size={13} />
                <span className="hidden sm:inline">
                  {workbenchMode === "comic" ? "漫画库" : "照片库"}
                </span>
              </button>
            }
          >
            <PopoverLabel>工作台</PopoverLabel>
            <PopoverItem onClick={() => onOpenWorkbench("photo")}>
              <ImageIcon size={13} />
              <span>打开照片库</span>
            </PopoverItem>
            <PopoverItem onClick={() => onOpenWorkbench("comic")}>
              <ReaderIcon size={13} />
              <span>打开漫画库</span>
            </PopoverItem>
          </Popover>
        )}

        {/* 视频模式没有底部工具条（<video> 自带 controls），
          换片按钮留在顶栏；图片模式的翻页在底部工具条里。 */}
        {isVideo && (
          <div className="hidden md:flex items-center gap-0.5">
            <HeaderIconButton
              onClick={onPrev}
              disabled={displayIndex <= 0}
              title="上一个视频 (PageUp)"
            >
              <ChevronLeftIcon size={14} />
            </HeaderIconButton>
            <HeaderIconButton
              onClick={onNext}
              disabled={displayIndex >= total - 1}
              title="下一个视频 (PageDown)"
            >
              <ChevronRightIcon size={14} />
            </HeaderIconButton>
          </div>
        )}

        {!narrow && (
          <HeaderIconButton
            onClick={onToggleFavorite}
            active={isFavorite}
            title={isFavorite ? "取消收藏 (S)" : "加入收藏 (S)"}
          >
            <StarIcon
              size={14}
              filled={isFavorite}
              className={isFavorite ? "text-theater-favorite" : ""}
            />
          </HeaderIconButton>
        )}
        {!narrow && supportsFullscreen() && (
          <HeaderIconButton onClick={fullscreen} title="全屏 (F11)">
            <FullscreenIcon size={14} />
          </HeaderIconButton>
        )}

        <Popover
          onOpenChange={onMenuChange}
          align="end"
          tone="reader"
          trigger={
            <HeaderIconButton title="更多">
              <MoreHorizontalIcon size={15} />
            </HeaderIconButton>
          }
        >
          {narrow && (
            <>
              {onOpenWorkbench && (
                <>
                  <PopoverItem onClick={() => onOpenWorkbench("comic")}>
                    打开漫画库
                  </PopoverItem>
                  <PopoverItem onClick={() => onOpenWorkbench("photo")}>
                    打开照片库
                  </PopoverItem>
                </>
              )}
              <PopoverItem active={isFavorite} onClick={onToggleFavorite}>
                {isFavorite ? "取消收藏" : "加入收藏"}
              </PopoverItem>
              {supportsFullscreen() && (
                <PopoverItem onClick={fullscreen}>全屏</PopoverItem>
              )}
            </>
          )}
          <PopoverLabel>内容</PopoverLabel>
          {!isVideo && (
            <PopoverItem onClick={onToggleInfo}>
              <InfoIcon size={13} />
              <span>图片信息</span>
              <span className="ml-auto text-caption text-white/55">I</span>
            </PopoverItem>
          )}
          {!isVideo && onToggleOverview && (
            <PopoverItem onClick={onToggleOverview}>
              <GridIcon size={13} />
              <span>目录</span>
              <span className="ml-auto text-caption text-white/55">T</span>
            </PopoverItem>
          )}
          {!isVideo && onOpenSettings && (
            <PopoverItem onClick={onOpenSettings}>阅读设置</PopoverItem>
          )}
          <PopoverItem onClick={onToggleHelp}>
            <KeyboardIcon size={13} />
            <span>快捷键</span>
            <span className="ml-auto text-caption text-white/55">?</span>
          </PopoverItem>
          {onSetCover && (
            <PopoverItem onClick={onSetCover}>
              <ImageIcon size={13} />
              <span>设为封面</span>
              <span className="ml-auto text-caption text-white/55">U</span>
            </PopoverItem>
          )}
          {onClearCover && hasCustomCover && (
            <PopoverItem onClick={onClearCover}>
              <RefreshIcon size={13} />
              <span>清除自定义封面</span>
              <span className="ml-auto text-caption text-white/55">⇧U</span>
            </PopoverItem>
          )}
          {!isVideo && mode === "double" && (
            <PopoverItem
              onClick={() => setDirection(direction === "ltr" ? "rtl" : "ltr")}
            >
              {direction === "ltr" ? (
                <ArrowRightLineIcon size={13} />
              ) : (
                <ArrowLeftLineIcon size={13} />
              )}
              <span>阅读方向：{direction === "ltr" ? "左→右" : "右→左"}</span>
              <span className="ml-auto text-caption text-white/55">L</span>
            </PopoverItem>
          )}
          <PopoverSeparator />
          <PopoverLabel>卷导航</PopoverLabel>
          <PopoverItem
            onClick={onPrevAlbum}
            disabled={!onPrevAlbum}
            title={!onPrevAlbum ? "已到首卷" : undefined}
          >
            上一卷
          </PopoverItem>
          <PopoverItem
            onClick={onNextAlbum}
            disabled={!onNextAlbum}
            title={!onNextAlbum ? "已到末卷" : undefined}
          >
            下一卷
          </PopoverItem>
          <PopoverSeparator />
          <PopoverLabel>跳转</PopoverLabel>
          <PopoverItem onClick={onJumpToFirst}>
            <span>{isVideo ? "第一个视频" : "第一页"}</span>
            <span className="ml-auto text-caption text-white/55">Home</span>
          </PopoverItem>
          <PopoverItem onClick={onJumpToLast}>
            <span>{isVideo ? "最后一个视频" : "最后一页"}</span>
            <span className="ml-auto text-caption text-white/55">End</span>
          </PopoverItem>
        </Popover>
      </div>
    </header>
  );
}

function HeaderIconButton({
  children,
  onClick,
  disabled,
  title,
  ariaLabel,
  active,
  ...aria
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  /** 可访问名；缺省时退回 title（图标按钮的可访问名不能只靠图标）。 */
  ariaLabel?: string;
  active?: boolean;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "menu";
}) {
  return (
    <button
      {...aria}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      aria-label={ariaLabel ?? title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? "bg-white/15 text-white"
          : "text-white/80 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
