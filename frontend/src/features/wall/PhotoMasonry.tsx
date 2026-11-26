import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import type { LibraryMediaItem } from "../../api/library";
import { useElementSize } from "../../hooks/useElementSize";
import { useVisibleWindow } from "../../hooks/useVisibleWindow";
import { ThumbImage } from "../common";
import { VideoCoverImage } from "../common";
import { CheckIcon, PickIcon, PlayFilledIcon, PlusIcon } from "../../ui/icons";
import {
  DEFAULT_MASONRY_RATIO,
  layoutMasonry,
  type MasonryInput,
} from "./masonryLayout";

interface Props<T extends LibraryMediaItem = LibraryMediaItem> {
  /** 要铺的照片，按给定顺序排。 */
  items: T[];
  /** 目标列宽（像素）：宽屏上列多、窄屏上列少。 */
  targetColumnWidth?: number;
  /** 列与列之间的间距（像素）。 */
  gap?: number;
  /** 点照片。 */
  onOpen: (item: T, index: number) => void;
  /** 照片的出处标签：跨相册的墙用它说明这张出自哪本。 */
  albumLabel?: (item: T) => string | undefined;
  /** 某张照片是否已在精选里。 */
  isPicked?: (id: string) => boolean;
  /** 把一张照片加入 / 移出精选。 */
  onTogglePick?: (item: T) => void;
  /** 多选模式：点照片改为勾选，不再打开大图。 */
  selecting?: boolean;
  /** 某张照片是否已被勾选。 */
  isSelected?: (id: string) => boolean;
  /** 勾选 / 取消勾选一张照片。 */
  onToggleSelect?: (item: T) => void;
  /** 右键这张照片。 */
  onContextMenu?: (item: T, event: MouseEvent<HTMLButtonElement>) => void;
  /** 还有下一批照片：滚到底时自动接。 */
  hasNextPage?: boolean;
  /** 正在接下一批。 */
  isLoadingMore?: boolean;
  /** 接下一批失败：已经铺出来的照片仍可浏览，重试交给用户。 */
  loadMoreError?: boolean;
  /** 接下一批。 */
  onLoadMore?: () => void;
  /**
   * 要滚到的条目下标。
   *
   * 大图预览翻到第几百张再关掉时，墙还停在顶上：用户得自己滚回去找。
   * 给出这个下标，墙就把刚才看的那张带回视野中央。
   */
  scrollToIndex?: number | null;
  /**
   * 悬停信息层里要不要写像素尺寸。
   *
   * 像素尺寸是给「随手看看」那种浏览用的读数；精选页的照片是拿来
   * 好好看的，尺寸写在下面只会把注意力拽到技术上。
   */
  showDimensions?: boolean;
}

const GAP = 10;

/**
 * 瀑布流照片墙：每张照片落进当前最矮的那一列。
 *
 * 与照片墙（justified）的区别是它不凑行：竖幅照片按原比例占位，
 * 各列高度参差，因此一面墙上能同时看到横的、竖的、大幅的与小幅的。
 *
 * 渲染是按视口裁的：一次可能排到几千张，全量挂进 DOM 会把浏览器
 * 拖垮，因此只有视口附近的那几张真正挂上节点，其余留白。
 */
export default function PhotoMasonry<
  T extends LibraryMediaItem = LibraryMediaItem,
>({
  items,
  targetColumnWidth = 260,
  gap = GAP,
  onOpen,
  albumLabel,
  isPicked,
  onTogglePick,
  selecting = false,
  isSelected,
  onToggleSelect,
  onContextMenu,
  hasNextPage = false,
  isLoadingMore = false,
  loadMoreError = false,
  onLoadMore,
  scrollToIndex = null,
  showDimensions = true,
}: Props<T>) {
  const {
    ref: containerRef,
    width,
    element,
  } = useElementSize<HTMLDivElement>();

  const inputs = useMemo<MasonryInput[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        ratio:
          item.width && item.height
            ? item.width / item.height
            : DEFAULT_MASONRY_RATIO,
      })),
    [items],
  );

  const layout = useMemo(
    () =>
      layoutMasonry(inputs, {
        containerWidth: width,
        targetColumnWidth,
        gap,
      }),
    [inputs, width, targetColumnWidth, gap],
  );

  const visible = useVisibleWindow(element, layout.height);

  // 续页：墙底挂一枚哨兵，滚到它就接下一批。
  //
  // 照片墙（justified）用虚拟列表的 endReached 续页，瀑布流没有那一层，
  // 自己看一枚哨兵。哨兵必须挂在墙的下面 —— 墙本身有确定高度，
  // 哨兵落在它后面，滚到底自然经过。
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasNextPage || !onLoadMore || isLoadingMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, onLoadMore, isLoadingMore, items.length]);

  // 回到刚才看的那张：关掉预览后用户仍然知道自己停在哪儿。
  useEffect(() => {
    if (scrollToIndex == null || scrollToIndex < 0) return;
    const container = element;
    if (!container) return;
    const tile = container.querySelector(
      `[data-masonry-index="${scrollToIndex}"]`,
    );
    if (tile) {
      tile.scrollIntoView({ block: "center" });
      return;
    }
    // 那一张还没挂上节点（视口裁掉了）：按它的位置滚过去。
    const target = layout.tiles[scrollToIndex];
    const scroller = container.closest("main");
    if (!target || !scroller) return;
    scroller.scrollTop += target.y - scroller.clientHeight / 2;
  }, [scrollToIndex, layout.tiles, element]);

  const tiles = useMemo(() => {
    if (visible.bottom <= visible.top) {
      // 还不知道视口在哪（首帧、静态渲染）：先全挂上，等下一次测量再裁。
      return layout.tiles;
    }
    return layout.tiles.filter(
      (tile) => tile.y + tile.height >= visible.top && tile.y <= visible.bottom,
    );
  }, [layout.tiles, visible.top, visible.bottom]);

  return (
    <>
      <div
        ref={containerRef}
        className="relative"
        style={{ height: layout.height }}
      >
        {tiles.map((tile) => {
          const item = items[tile.index];
          if (!item) return null;
          const isVideo = item.kind === "video";
          const picked = isPicked?.(item.id) ?? false;
          const selected = isSelected?.(item.id) ?? false;
          const sourceLabel = albumLabel?.(item);
          return (
            <div
              key={tile.id}
              data-masonry-index={tile.index}
              className="group absolute overflow-hidden rounded-md bg-bg-subtle shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-shadow duration-200 hover:shadow-[0_6px_18px_rgba(0,0,0,0.28)]"
              style={{
                transform: `translate(${tile.x}px, ${tile.y}px)`,
                width: tile.width,
                height: tile.height,
              }}
            >
              {isVideo ? (
                <VideoCoverImage
                  videoPath={item.id}
                  version={item.version}
                  displayWidth={tile.width}
                  alt={item.name}
                  loading="lazy"
                />
              ) : (
                <ThumbImage
                  fileId={item.id}
                  alt={item.name}
                  loading="lazy"
                  version={item.version}
                  displayWidth={tile.width}
                  undecodable={item.undecodable}
                  className="h-full w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.03] motion-safe:group-active:scale-[1.03]"
                />
              )}
              <button
                type="button"
                onClick={() =>
                  selecting && onToggleSelect
                    ? onToggleSelect(item)
                    : onOpen(item, tile.index)
                }
                onContextMenu={(event) => onContextMenu?.(item, event)}
                className="absolute inset-0 z-0 block h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal"
                title={
                  sourceLabel ? `${sourceLabel} · ${item.name}` : item.name
                }
                aria-label={
                  selecting && onToggleSelect
                    ? `选择「${item.name}」`
                    : isVideo
                      ? `播放 ${item.name}`
                      : `查看 ${item.name}`
                }
              />
              {selected ? (
                <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 inline-flex h-5 items-center gap-1 rounded-md bg-accent px-1.5 text-micro font-medium text-accent-contrast">
                  <CheckIcon size={11} />
                  已选
                </span>
              ) : null}
              {isVideo && (
                <span className="pointer-events-none absolute right-1.5 top-1.5 z-0 inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-caption font-medium text-white/90">
                  <PlayFilledIcon size={10} />
                  <span>视频</span>
                </span>
              )}
              {onTogglePick && !selecting && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onTogglePick(item);
                  }}
                  aria-pressed={picked}
                  aria-label={
                    picked
                      ? `把 ${item.name} 移出精选`
                      : `把 ${item.name} 加入精选`
                  }
                  title={picked ? "移出精选" : "加入精选"}
                  className={`absolute left-0 top-0 z-10 grid size-8 place-items-center rounded-full transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white touch:size-11 ${
                    picked
                      ? "opacity-100"
                      : "hover-reveal group-hover:opacity-100 group-focus-within:opacity-100"
                  }`}
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white ring-1 ring-white/25">
                    {picked ? <PickIcon size={12} /> : <PlusIcon size={11} />}
                  </span>
                </button>
              )}
              {/* 信息层：出处相册与文件名。
                  跨相册的墙上，照片来自不同的本 —— 先说清它出自哪本。
                  显隐由 .hover-reveal 管：鼠标设备上悬停才浮出，
                  触摸设备上常驻（像素尺寸在触摸端收起）。 */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 translate-y-1 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-6 hover-reveal transition-opacity duration-200 motion-safe:group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:opacity-100">
                <p className="truncate text-caption font-medium text-white/95">
                  {sourceLabel ?? item.name}
                </p>
                {showDimensions && item.width && item.height ? (
                  <p className="mouse-only touch:hidden truncate text-caption text-white/75">
                    {item.width}×{item.height}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {/* 续页哨兵。 */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
      {hasNextPage && loadMoreError ? (
        <div className="pb-4 pt-3 text-center">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? "正在加载…" : "重试加载更多"}
          </button>
        </div>
      ) : null}
    </>
  );
}
