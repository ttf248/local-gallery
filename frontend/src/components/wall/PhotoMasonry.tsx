import { useMemo } from "react";
import type { LibraryMediaItem } from "../../api/library";
import { useElementSize } from "../../hooks/useElementSize";
import { useVisibleWindow } from "../../hooks/useVisibleWindow";
import ThumbImage from "../common/ThumbImage";
import VideoCoverImage from "../common/VideoCoverImage";
import { PickIcon, PlayFilledIcon, PlusIcon } from "../common/Icon";
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
        const sourceLabel = albumLabel?.(item);
        return (
          <div
            key={tile.id}
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
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] group-active:scale-[1.03]"
              />
            )}
            <button
              type="button"
              onClick={() => onOpen(item, tile.index)}
              className="absolute inset-0 z-0 block h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
              title={sourceLabel ? `${sourceLabel} · ${item.name}` : item.name}
              aria-label={isVideo ? `播放 ${item.name}` : `查看 ${item.name}`}
            />
            {isVideo && (
              <span className="pointer-events-none absolute right-1.5 top-1.5 z-0 inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-meta font-medium text-white/90 backdrop-blur">
                <PlayFilledIcon size={10} />
                <span>视频</span>
              </span>
            )}
            {onTogglePick && (
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
                className={`absolute left-0 top-0 z-10 grid h-7 w-7 place-items-center rounded-full transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  picked ? "opacity-100" : "hover-reveal group-hover:opacity-100 group-focus-within:opacity-100"
                }`}
              >
                <span className="grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white ring-1 ring-white/25 backdrop-blur">
                  {picked ? <PickIcon size={12} /> : <PlusIcon size={11} />}
                </span>
              </button>
            )}
            {/* 信息层：出处相册与文件名。
                跨相册的墙上，照片来自不同的本 —— 先说清它出自哪本。
                显隐由 .hover-reveal 管：鼠标设备上悬停才浮出，
                触摸设备上常驻（像素尺寸在触摸端收起）。 */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 translate-y-1 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-6 hover-reveal transition-opacity duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:opacity-100">
              <p className="truncate text-meta font-medium text-white/95">
                {sourceLabel ?? item.name}
              </p>
              {item.width && item.height ? (
                <p className="mouse-only truncate text-meta text-white/75">
                  {item.width}×{item.height}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
