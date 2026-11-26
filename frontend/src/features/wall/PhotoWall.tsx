import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Virtuoso, type ListRange, type VirtuosoHandle } from "react-virtuoso";
import { queryClient } from "../../api/queryClient";
import { getVideoInfo } from "../../api/videos";
import { useDebounce } from "../../hooks/useDebounce";
import { formatDuration } from "../../utils/format";
import type { LibraryMediaItem } from "../../api/library";
import { useElementSize } from "../../hooks/useElementSize";
import { useMediaGridPagination } from "../../hooks/useMediaGridPagination";
import MediaTile from "./MediaTile";
import { packSections, type WallBand } from "../timeline";
import { useDensityShortcuts } from "./useDensityShortcuts";
import {
  autoTargetHeight,
  effectiveTargetHeight,
  layoutJustified,
  tileRatio,
  type PlacedTile,
  type WallTile,
} from "./justifiedLayout";

interface Props<T extends LibraryMediaItem = LibraryMediaItem> {
  /** 已加载的媒体项，顺序与服务端媒体索引一致。 */
  items: T[];
  /** 图片与视频合计的服务端总数。 */
  total: number;
  /**
   * 目标行高（像素）。
   *
   * 不传就是自适应：按数量、比例与视口算出该用多疏的行高。手动密度
   * 传固定值，自适应不会覆盖它 —— 用户明确选过的东西不该被改回去。
   */
  targetHeight?: number;
  /** 自适应模式的密度下限：自适应不会比这一档更密。 */
  minTargetHeight?: number;
  hasNextPage: boolean;
  isLoadingMore: boolean;
  /**
   * 取下一页失败：已加载的内容仍然能翻，但不再自动接下一页。
   *
   * 失败状态下自动续页会变成一条无限请求：条件（已到末尾、还有下一页）
   * 一直成立，失败一次接一次。传进来让自动续页停下来，重试交给用户。
   */
  loadMoreError?: boolean;
  onLoadMore: () => void;
  onOpen: (item: T, index: number) => void;
  onContextMenu?: (item: T, event: MouseEvent<HTMLButtonElement>) => void;
  /**
   * 照片的出处标签（跨相册的墙上才有意义）。
   *
   * 返回所属相册名时，悬停信息层显示相册名而不是文件名：用户在年份
   * 墙这类跨相册的墙上想知道的是「这张出自哪本」。
   */
  albumLabel?: (item: T) => string | undefined;
  /** 可选媒体角标，如语义搜索相似度。 */
  itemBadge?: (item: T) => string | undefined;
  /** 照片上的额外标记，如人物相册中属于当前分组的人脸框。 */
  itemOverlay?: (item: T, tile: { width: number; height: number }) => ReactNode;
  /** 独立于图片缩放层的瓦片操作，例如展开相似组。 */
  itemAction?: (item: T) => ReactNode;
  /** 是否处于多选模式。多选时点击照片改为勾选，不再打开大图。 */
  selecting?: boolean;
  /** 某张照片是否已被勾选。 */
  isSelected?: (id: string) => boolean;
  /** 勾选 / 取消勾选一张照片。 */
  onToggleSelect?: (item: T, range?: boolean) => void;
  /** 某张照片是否在精选里。 */
  isPicked?: (id: string) => boolean;
  /** 把一张照片加入 / 移出精选。 */
  onTogglePick?: (item: T) => void;
  /**
   * 要滚到的条目下标。
   *
   * 大图预览翻到第几百张再关掉时，墙还停在顶上：用户得自己滚回去找。
   * 给出这个下标，墙就把刚才看的那张带回视野中央 —— 关掉预览仍然
   * 知道自己停在哪儿。
   */
  scrollToIndex?: number | null;
  /**
   * 分组键：给出一个媒体项属于哪一段（如月份）。
   *
   * 给了 groupOf 与 groupHeader，墙就在每组的第一行之前插一条标题行。
   * 时间线靠它把照片按月份分段；不给就是一面没有分段的墙。
   */
  groupOf?: (item: T) => string | undefined;
  /** 分组标题的内容。 */
  groupHeader?: (groupKey: string) => ReactNode;
  onVisibleGroupChange?: (groupKey: string) => void;
  scrollParent?: HTMLElement;
  onPinnedGroupChange?: (groupKey: string) => void;
  /**
   * 要不要给未加载的条目留占位槽。
   *
   * 占位槽按整本的数量铺满滚动长度：用户在相册里能拖着滚动条
   * 直接看到末尾。但它有两个代价 —— 跳到远处时看到的是一屏灰格子，
   * 而且那些格子要把整本都取回来才填得上。
   *
   * 全库级的时间线因此关掉占位：墙只铺已经取回来的照片，
   * 往下滚到末尾就接下一页，屏幕上一直是真的照片。
   */
  showPlaceholders?: boolean;
}

/**
 * 照片墙：按每张图真实宽高比排布的自适应网格。
 *
 * 与漫画阅读器彻底分开：这里没有页码、没有双页、没有阅读进度，
 * 只有「平铺浏览 → 点开大图」这一条路径。
 */
export default function PhotoWall<
  T extends LibraryMediaItem = LibraryMediaItem,
>({
  items,
  total,
  targetHeight,
  minTargetHeight = 210,
  hasNextPage,
  isLoadingMore,
  loadMoreError = false,
  onLoadMore,
  onOpen,
  onContextMenu,
  albumLabel,
  itemBadge,
  itemOverlay,
  itemAction,
  selecting = false,
  isSelected,
  onToggleSelect,
  isPicked,
  onTogglePick,
  scrollToIndex = null,
  groupOf,
  groupHeader,
  onVisibleGroupChange, scrollParent, onPinnedGroupChange,
  showPlaceholders = true,
}: Props<T>) {
  const {
    ref: measureScroller,
    width,
    height: measuredHeight,
    element: container,
  } = useElementSize<HTMLDivElement>();
  const height = scrollParent?.clientHeight ?? measuredHeight;
  // 按滚动区域的实际可用宽度排图，桌面滚动条会占用部分墙宽。
  const scrollerRef = useCallback(
    (node: HTMLElement | Window | null) =>
      measureScroller(node instanceof HTMLDivElement ? node : null),
    [measureScroller],
  );
  const [videoTarget, setVideoTarget] = useState<LibraryMediaItem>();
  const focusedVideo = useDebounce(videoTarget, 180);
  const [videoDuration, setVideoDuration] = useState<{
    id: string;
    text: string;
  }>();

  useEffect(() => {
    if (!focusedVideo) return;
    let current = true;
    void queryClient
      .fetchQuery({
        queryKey: ["video-info", focusedVideo.id, focusedVideo.version],
        queryFn: () => getVideoInfo(focusedVideo.id),
        staleTime: 60_000,
        retry: false,
      })
      .then(({ duration }) => {
        if (
          current &&
          duration != null &&
          Number.isFinite(duration) &&
          duration > 0
        ) {
          setVideoDuration({
            id: focusedVideo.id,
            text: formatDuration(duration),
          });
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [focusedVideo]);

  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  // 记住上一次处理过的下标：同一个下标不重复滚，避免用户手动滚了墙
  // 之后又被拉回去。
  const handledScrollRef = useRef<number | null>(null);

  const rangeChanged = useMediaGridPagination({
    loadedCount: items.length,
    hasNextPage,
    isLoadingMore,
    loadMoreError,
    onLoadMore,
  });

  // 未加载的条目也占位，保证滚动长度与整本相册一致；它们的比例是估算值，
  // 真实尺寸到达后会重排，但重排只发生在视口之外的行。
  const tiles = useMemo<WallTile[]>(() => {
    const count = showPlaceholders
      ? Math.max(total, items.length)
      : items.length;
    const list: WallTile[] = [];
    for (let index = 0; index < count; index += 1) {
      const item = items[index];
      list.push({
        id: item?.id ?? `wall-placeholder-${index}`,
        ratio: tileRatio(item),
      });
    }
    return list;
  }, [items, total, showPlaceholders]);

  // 窄屏的上下限：容器只有三百多像素宽时，「标准」的行高放得下一张就放
  // 不下第二张，一百多张照片要滚几十屏；反过来行高太大也会退化成
  // 一行一张的列表。
  const gap = targetHeight === 150 ? 2 : targetHeight === 290 ? 8 : 4;
  const narrowBound = width > 0 ? Math.max(96, Math.round(width / 3.2)) : 0;
  // 自适应只在「更疏」的方向上动：照片少时把画面让给每一张，照片多时
  // 保持浏览密度，不因为自适应反而变得更挤。
  const autoFloor = Math.min(minTargetHeight, narrowBound || minTargetHeight);
  const effectiveHeight = useMemo(() => {
    if (targetHeight !== undefined) {
      return effectiveTargetHeight(targetHeight, width);
    }
    return autoTargetHeight(tiles, {
      containerWidth: width,
      containerHeight: height,
      gap,
      minTargetHeight: autoFloor,
      maxTargetHeight: narrowBound || undefined,
    });
  }, [tiles, width, height, targetHeight, autoFloor, narrowBound, gap]);

  const itemIndex = useMemo(() => {
    const map = new Map<string, number>();
    tiles.forEach((tile, index) => map.set(tile.id, index));
    return map;
  }, [tiles]);

  const entries = useMemo<WallBand[]>(() => {
    if (!groupOf) {
      return layoutJustified(tiles, {
        containerWidth: width,
        targetHeight: effectiveHeight,
        gap,
      }).map((row) => ({ ...row, kind: "row", sectionKey: "" }));
    }
    const sections: { key: string; year: string; tiles: WallTile[] }[] = [];
    tiles.forEach((tile, index) => {
      const key = (items[index] && groupOf(items[index])) || "unknown";
      let section = sections.at(-1);
      if (!section || section.key !== key) {
        section = { key, year: key.split("-")[0], tiles: [] };
        sections.push(section);
      }
      section.tiles.push(tile);
    });
    return packSections(sections, {
      containerWidth: width,
      targetHeight: width < 640 ? 120 : effectiveHeight,
      gap,
    });
  }, [groupOf, tiles, items, width, effectiveHeight, gap]);

  const bandIndex = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((entry, index) => {
      if (entry.kind === "row")
        entry.tiles.forEach((tile) => map.set(tile.id, index));
      if (entry.kind === "inline")
        entry.segments.forEach((segment) =>
          segment.tiles.forEach((tile) => map.set(tile.id, index)),
        );
    });
    return map;
  }, [entries]);

  const latestBands = useRef(bandIndex);
  latestBands.current = bandIndex;
  useDensityShortcuts({
    enabled: Boolean(container && width > 0),
    autoResolvedHeight: effectiveHeight,
    getAnchorId: () => {
      if (!container) return null;
      const rect = (scrollParent ?? container).getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      if (hit && container.contains(hit)) {
        const tile = hit.closest<HTMLElement>("[data-media-id]");
        if (tile) return tile.dataset.mediaId ?? null;
      }
      let distance = Infinity,
        nearest: string | null = null;
      container
        .querySelectorAll<HTMLElement>("[data-media-id]")
        .forEach((tile) => {
          const bounds = tile.getBoundingClientRect();
          const d = Math.hypot(
            bounds.x + bounds.width / 2 - rect.x - rect.width / 2,
            bounds.y + bounds.height / 2 - rect.y - rect.height / 2,
          );
          if (d < distance) {
            distance = d;
            nearest = tile.dataset.mediaId ?? null;
          }
        });
      return nearest;
    },
    restoreAnchor: (id) => {
      const tile=Array.from(container?.querySelectorAll<HTMLElement>("[data-media-id]") ?? []).find(node=>node.dataset.mediaId===id);
      if(tile){tile.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"});return;}
      const index = latestBands.current.get(id);
      if (index !== undefined)
        virtuosoRef.current?.scrollToIndex({ index, align: "center" });
    },
  });
  useEffect(() => {
    if (scrollToIndex == null) {
      handledScrollRef.current = null;
      return;
    }
    const id = items[scrollToIndex]?.id;
    const index = bandIndex.get(id);
    if (index === undefined || handledScrollRef.current === scrollToIndex)
      return;
    handledScrollRef.current = scrollToIndex;
    virtuosoRef.current?.scrollToIndex({ index, align: "center" });
    if (!container) return;
    const focus = () => {
      const tile = Array.from(
        container.querySelectorAll<HTMLElement>("[data-media-id]"),
      ).find((el) => el.dataset.mediaId === id);
      const button = tile?.querySelector<HTMLButtonElement>("[data-open]");
      button?.focus({ preventScroll: true });
      return Boolean(button);
    };
    if (focus()) return;
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [scrollToIndex, items, bandIndex, container]);

  const visibleGroup = useRef<string>();
  const reportVisibleGroup = useCallback(() => {
    if (!onVisibleGroupChange || !container) return;
    const bounds = (scrollParent ?? container).getBoundingClientRect();
    const toolbar = scrollParent?.querySelector<HTMLElement>("[data-stuck=true]");
    const top = toolbar?.getBoundingClientRect().bottom ?? bounds.top;
    const first = Array.from(container.querySelectorAll<HTMLElement>("[data-wall-group]")).find(element => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > top + 1 && rect.top < bounds.bottom;
    });
    const group = first?.dataset.wallGroup;
    if(onPinnedGroupChange) {
      const header = first?.querySelector<HTMLElement>("[data-testid=timeline-group-header]");
      onPinnedGroupChange(first && first.getBoundingClientRect().top <= top && (!header || header.getBoundingClientRect().bottom<=top) ? group ?? "" : "");
    }
    if (!group || group === visibleGroup.current) return;
    visibleGroup.current = group;
    onVisibleGroupChange(group);
  },[container,scrollParent,onVisibleGroupChange,onPinnedGroupChange]);
  useEffect(()=>{
    if(!scrollParent)return;
    scrollParent.addEventListener("scroll",reportVisibleGroup,{passive:true});
    return ()=>scrollParent.removeEventListener("scroll",reportVisibleGroup);
  },[scrollParent,reportVisibleGroup]);

  const handleRangeChanged = (range: ListRange) => {
    reportVisibleGroup();
    // 标题行不算媒体：可见范围要落在照片行上，否则翻页的边界会算错。
    let start = Number.POSITIVE_INFINITY;
    let end = -1;
    for (let index = range.startIndex; index <= range.endIndex; index += 1) {
      const entry = entries[index];
      if (!entry || entry.kind === "header") continue;
      const first =
        entry.kind === "row" ? entry.tiles[0] : entry.segments[0]?.tiles[0];
      const last =
        entry.kind === "row"
          ? entry.tiles.at(-1)
          : entry.segments.at(-1)?.tiles.at(-1);
      if (first && last) {
        start = Math.min(start, itemIndex.get(first.id) ?? Infinity);
        end = Math.max(end, itemIndex.get(last.id) ?? -1);
      }
    }
    if (start === Number.POSITIVE_INFINITY || end < 0) return;
    rangeChanged({ startIndex: start, endIndex: end });
  };

  function renderTiles(placed: PlacedTile[], tileHeight: number) {
    return placed.map((tile) => {
      const index = itemIndex.get(tile.id) ?? 0,
        item = items[index];
      if (!item)
        return (
          <div
            key={tile.id}
            aria-hidden="true"
            className="shrink-0 animate-pulse rounded-tile bg-media"
            style={{ width: tile.width, height: tileHeight }}
          />
        );
      return (
        <MediaTile
          key={item.id}
          item={item}
          width={tile.width}
          height={tileHeight}
          onOpen={() => onOpen(item, index)}
          onContextMenu={
            onContextMenu && ((event) => onContextMenu(item, event))
          }
          sourceLabel={albumLabel?.(item)}
          badge={itemBadge?.(item)}
          action={itemAction?.(item)}
          overlay={itemOverlay?.(item, {
            width: tile.width,
            height: tileHeight,
          })}
          selected={Boolean(isSelected?.(item.id))}
          selecting={selecting}
          picked={Boolean(isPicked?.(item.id))}
          onSelect={
            onToggleSelect &&
            ((range) =>
              range ? onToggleSelect(item, true) : onToggleSelect(item))
          }
          onPick={onTogglePick && (() => onTogglePick(item))}
          onVideoFocus={(active) => setVideoTarget(active ? item : undefined)}
          duration={
            videoDuration?.id === item.id ? videoDuration.text : undefined
          }
        />
      );
    });
  }
  return (
    <div
      ref={scrollParent ? measureScroller : undefined}
      className={scrollParent ? "min-w-0" : "h-full min-h-0"}
      onScrollCapture={onVisibleGroupChange ? reportVisibleGroup : undefined}
    >
      <Virtuoso
        customScrollParent={scrollParent}
        scrollerRef={scrollParent ? undefined : scrollerRef}
        ref={virtuosoRef}
        data={entries}
        style={scrollParent ? undefined : { height: "100%" }}
        overscan={600}
        increaseViewportBy={{ top: 600, bottom: 600 }}
        defaultItemHeight={effectiveHeight + gap}
        computeItemKey={(_index, entry) => entry.key}
        rangeChanged={handleRangeChanged}
        itemContent={(_index, entry) => {
          if (entry.kind === "header")
            return (
              <div className="pt-8 pb-3" data-wall-group={entry.sectionKey}>
                {groupHeader?.(entry.sectionKey)}
              </div>
            );
          if (entry.kind === "inline")
            return (
              <div
                className="flex items-end gap-8"
                data-wall-group={entry.segments[0].key}
                style={{ paddingBottom: gap }}
              >
                {entry.segments.map((segment) => (
                  <div
                    key={segment.key}
                    className="min-w-0"
                    style={{ width: segment.width }}
                  >
                    <div className="overflow-hidden pt-8 pb-3">
                      {groupHeader?.(segment.key)}
                    </div>
                    <div className="flex" style={{ gap }}>
                      {renderTiles(segment.tiles, entry.tileHeight)}
                    </div>
                  </div>
                ))}
              </div>
            );
          return (
            <div
              className="flex items-start"
              data-wall-group={entry.sectionKey || undefined}
              style={{ height: entry.height, gap, paddingBottom: gap }}
            >
              {renderTiles(entry.tiles, entry.tileHeight)}
            </div>
          );
        }}
      />
    </div>
  );
}
