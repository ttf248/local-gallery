import {
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
import ThumbImage from "../common/ThumbImage";
import VideoCoverImage from "../common/VideoCoverImage";
import { CheckIcon, PickIcon, PlayFilledIcon, PlusIcon } from "../../ui/icons";
import {
  autoTargetHeight,
  effectiveTargetHeight,
  layoutGroup,
  layoutJustified,
  SPARSE_MAX_HEIGHT,
  SPARSE_MIN_HEIGHT,
  tileRatio,
  type WallRow,
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
  /** 是否处于多选模式。多选时点击照片改为勾选，不再打开大图。 */
  selecting?: boolean;
  /** 某张照片是否已被勾选。 */
  isSelected?: (id: string) => boolean;
  /** 勾选 / 取消勾选一张照片。 */
  onToggleSelect?: (item: T) => void;
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
 * 虚拟列表的一项：分组标题行或照片行。
 *
 * 两者混在同一个列表里，顺序就是屏幕上的顺序 —— 虚拟列表按项的高度
 * 排布，标题行与照片行混排不必另开一个滚动容器。
 */
type WallEntry =
  | { kind: "group"; key: string; group: string }
  | { kind: "row"; key: string; row: WallRow; startIndex: number };

const GAP = 6;

/**
 * 分组排布时每一段自己的行高区间（像素）。
 *
 * 整面墙用同一套行高，稀疏的月份会被拉到密集月份的高度：一个月里
 * 只有两张照片，那两张却和几十张的月份一样大，那一段看着像缺了内容。
 * 分段各算各的，密集的月份保持浏览密度，冷清的月份把画面让出来。
 */
const GROUP_MIN_HEIGHT = 190;
const GROUP_MAX_HEIGHT = 240;

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
  selecting = false,
  isSelected,
  onToggleSelect,
  isPicked,
  onTogglePick,
  scrollToIndex = null,
  groupOf,
  groupHeader,
  onVisibleGroupChange,
  showPlaceholders = true,
}: Props<T>) {
  const {
    ref: containerRef,
    width,
    height,
    element: container,
  } = useElementSize<HTMLDivElement>();
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
      gap: GAP,
      minTargetHeight: autoFloor,
      maxTargetHeight: narrowBound || undefined,
    });
  }, [tiles, width, height, targetHeight, autoFloor, narrowBound]);

  const rows = useMemo(
    () =>
      layoutJustified(tiles, {
        containerWidth: width,
        targetHeight: effectiveHeight,
        gap: GAP,
      }),
    [tiles, width, effectiveHeight],
  );

  const itemIndex = useMemo(() => {
    const map = new Map<string, number>();
    tiles.forEach((tile, index) => map.set(tile.id, index));
    return map;
  }, [tiles]);

  // 分组：每一组单独排一次，组与组之间不混排。
  //
  // 一行里横跨两个月，那个月的标题就贴错了地方 —— 标题说的是第一张
  // 照片的月份，行尾那几张其实是下一个月拍的。分组排布让每一组从新
  // 的一行开始，标题与照片永远对得上。
  const groups = useMemo(() => {
    if (!groupOf) return [];
    const list: { key: string; tiles: WallTile[] }[] = [];
    tiles.forEach((tile, index) => {
      const item = items[index];
      const key = item ? groupOf(item) : undefined;
      const groupKey = key ?? "";
      let group = list.at(-1);
      if (!group || group.key !== groupKey) {
        group = { key: groupKey, tiles: [] };
        list.push(group);
      }
      group.tiles.push(tile);
    });
    return list;
  }, [tiles, items, groupOf]);

  // 每一段自己的行高：照片少的月份给大一点，多的月份保持浏览密度。
  //
  // 用户手动选过密度就按他选的来 —— 明确选过的东西不该被自动改回去。
  const groupFloor = Math.min(
    GROUP_MIN_HEIGHT,
    narrowBound || GROUP_MIN_HEIGHT,
  );
  const groupCeiling = Math.max(
    groupFloor,
    Math.min(GROUP_MAX_HEIGHT, narrowBound || GROUP_MAX_HEIGHT),
  );
  const groupHeights = useMemo(() => {
    const map = new Map<string, number>();
    if (!groupOf || targetHeight !== undefined) return map;
    for (const group of groups) {
      map.set(
        group.key,
        autoTargetHeight(group.tiles, {
          containerWidth: width,
          containerHeight: height,
          gap: GAP,
          minTargetHeight: groupFloor,
          maxTargetHeight: groupCeiling,
        }),
      );
    }
    return map;
  }, [groups, groupOf, width, height, groupFloor, groupCeiling, targetHeight]);

  // 稀疏段（照片少得一行放得下）的高度区间：手动密度按用户选的那一档，
  // 自适应则给一段更宽松的区间 —— 少到两三张时，那几张本来就该大一些。
  const sparseBand = useMemo(() => {
    if (targetHeight !== undefined) {
      const height = effectiveTargetHeight(targetHeight, width);
      return { min: height, max: height };
    }
    return { min: SPARSE_MIN_HEIGHT, max: SPARSE_MAX_HEIGHT };
  }, [targetHeight, width]);

  // 虚拟列表的数据：分组标题行与照片行混在一起。
  //
  // 给了 groupOf 时每一组单独排一次，标题行插在每组的第一行之前；
  // 没给 groupOf 时就是一面没有分段的墙，整墙一起排。
  const entries = useMemo<WallEntry[]>(() => {
    if (!groupOf) {
      return rows.map((row, index) => {
        const first = row.tiles[0];
        const startIndex = first ? (itemIndex.get(first.id) ?? index) : index;
        return { kind: "row", key: row.key, row, startIndex };
      });
    }
    const list: WallEntry[] = [];
    for (const group of groups) {
      if (group.key) {
        list.push({
          kind: "group",
          key: "group-" + group.key,
          group: group.key,
        });
      }
      const groupRows = layoutGroup(group.tiles, {
        containerWidth: width,
        gap: GAP,
        targetHeight:
          targetHeight !== undefined
            ? effectiveTargetHeight(targetHeight, width)
            : (groupHeights.get(group.key) ?? effectiveHeight),
        sparseMinHeight: sparseBand.min,
        sparseMaxHeight: sparseBand.max,
      });
      for (const row of groupRows) {
        const first = row.tiles[0];
        const startIndex = first ? (itemIndex.get(first.id) ?? 0) : 0;
        list.push({ kind: "row", key: row.key, row, startIndex });
      }
    }
    return list;
  }, [
    rows,
    groups,
    groupHeights,
    sparseBand,
    itemIndex,
    groupOf,
    width,
    targetHeight,
    effectiveHeight,
  ]);

  // 滚到指定条目：条目下标先换算成行下标，虚拟列表按行滚。
  useEffect(() => {
    if (scrollToIndex === null || scrollToIndex === undefined) {
      // 没有目标时把记录清掉：下次给同一个下标仍然要滚（同一张照片
      // 看了又看，位置得重新对回去）。
      handledScrollRef.current = null;
      return;
    }
    if (handledScrollRef.current === scrollToIndex) return;
    const entryIndex = entries.findIndex(
      (entry) =>
        entry.kind === "row" &&
        entry.row.tiles.some(
          (tile) => itemIndex.get(tile.id) === scrollToIndex,
        ),
    );
    if (entryIndex < 0) return;
    handledScrollRef.current = scrollToIndex;
    virtuosoRef.current?.scrollToIndex({ index: entryIndex, align: "center" });
  }, [scrollToIndex, entries, itemIndex]);

  const visibleGroup = useRef<string>();
  const reportVisibleGroup = () => {
    const root = container;
    if (!onVisibleGroupChange || !root) return;
    const bounds = root.getBoundingClientRect();
    const first = Array.from(
      root.querySelectorAll<HTMLElement>("[data-wall-group]"),
    ).find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > bounds.top + 1 && rect.top < bounds.bottom;
    });
    const group = first?.dataset.wallGroup;
    if (!group || group === visibleGroup.current) return;
    visibleGroup.current = group;
    onVisibleGroupChange(group);
  };

  const handleRangeChanged = (range: ListRange) => {
    reportVisibleGroup();
    // 标题行不算媒体：可见范围要落在照片行上，否则翻页的边界会算错。
    let start = Number.POSITIVE_INFINITY;
    let end = -1;
    for (let index = range.startIndex; index <= range.endIndex; index += 1) {
      const entry = entries[index];
      if (!entry || entry.kind !== "row") continue;
      start = Math.min(start, entry.startIndex);
      end = Math.max(end, entry.startIndex + entry.row.tiles.length - 1);
    }
    if (start === Number.POSITIVE_INFINITY || end < 0) return;
    rangeChanged({ startIndex: start, endIndex: end });
  };

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0"
      onScrollCapture={onVisibleGroupChange ? reportVisibleGroup : undefined}
    >
      {width > 0 && (
        <Virtuoso
          ref={virtuosoRef}
          data={entries}
          style={{ height: "100%" }}
          overscan={600}
          increaseViewportBy={{ top: 600, bottom: 600 }}
          defaultItemHeight={effectiveHeight + GAP}
          computeItemKey={(_index, entry) => entry.key}
          rangeChanged={handleRangeChanged}
          itemContent={(_index, entry) => {
            if (entry.kind === "group") {
              return (
                /* 分段标题：上面留一整段空白，下面紧贴照片。标题是这一段
                   的骨架，空白就是它的层级 —— 挤在照片边上时读不出
                   「这一段从这儿开始」。 */
                <div
                  className="timeline-group-space"
                  data-wall-group={entry.group}
                >
                  {groupHeader?.(entry.group)}
                </div>
              );
            }
            const row = entry.row;
            return (
              <div
                className="flex items-start"
                data-wall-group={
                  onVisibleGroupChange && items[entry.startIndex]
                    ? groupOf?.(items[entry.startIndex])
                    : undefined
                }
                style={{
                  height: row.height,
                  gap: GAP,
                  paddingBottom: GAP,
                }}
              >
                {row.tiles.map((tile) => {
                  const index = itemIndex.get(tile.id) ?? 0;
                  const item = items[index];
                  if (!item) {
                    return (
                      <div
                        key={tile.id}
                        className="ui-skeleton shrink-0 animate-pulse"
                        style={{ width: tile.width, height: row.tileHeight }}
                        aria-hidden="true"
                      />
                    );
                  }
                  const isVideo = item.kind === "video";
                  const hasSize =
                    typeof item.width === "number" &&
                    typeof item.height === "number" &&
                    item.width > 0 &&
                    item.height > 0;
                  const picked = isPicked?.(item.id) ?? false;
                  const selected = isSelected?.(item.id) ?? false;
                  // 跨相册的墙上，照片的出处比文件名更值得说。
                  const sourceLabel = albumLabel?.(item);
                  const badge = itemBadge?.(item);
                  const overlay = itemOverlay?.(item, {
                    width: tile.width,
                    height: row.tileHeight,
                  });
                  return (
                    // 触发层是覆盖在封面之上的独立按钮：视频封面自带「重试」
                    // 按钮，把它包进 <button> 会产生嵌套按钮（无效 HTML，
                    // 键盘与读屏都会失灵）。
                    <div
                      key={tile.id}
                      /* 墙上挂的是一张张照片：它们之间留一道缝、角上带一点
                         圆，彼此分开而不是糊成一张大图。 */
                      className="photo-wall-tile group relative shrink-0 overflow-hidden rounded-media bg-bg-media"
                      style={{ width: tile.width, height: row.tileHeight }}
                    >
                      {isVideo ? (
                        <VideoCoverImage
                          fit="cover"
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
                      {overlay}
                      {badge && (
                        <span className="pointer-events-none absolute right-1.5 top-1.5 z-10 rounded-md bg-black/70 px-2 py-1 text-meta font-medium tabular-nums text-white backdrop-blur">
                          {badge}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          // 多选模式下点击是勾选，不是打开：那一轮用户在做
                          // 「挑出几张」，不是在「看这一张」。
                          if (selecting && onToggleSelect) onToggleSelect(item);
                          else onOpen(item, index);
                        }}
                        onPointerEnter={
                          isVideo ? () => setVideoTarget(item) : undefined
                        }
                        onPointerLeave={
                          isVideo ? () => setVideoTarget(undefined) : undefined
                        }
                        onFocus={
                          isVideo ? () => setVideoTarget(item) : undefined
                        }
                        onBlur={
                          isVideo ? () => setVideoTarget(undefined) : undefined
                        }
                        onContextMenu={(event) => onContextMenu?.(item, event)}
                        className="absolute inset-0 z-0 block h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                        title={
                          sourceLabel
                            ? `${sourceLabel} · ${item.name}`
                            : item.name
                        }
                        aria-label={
                          isVideo ? `播放 ${item.name}` : `查看 ${item.name}`
                        }
                      />
                      {/* 视频角标：光靠一枚 10px 的三角不够 —— 形状与颜色都
                          说不清这是什么，带上「视频」两个字才不依赖颜色辨认。
                          角标带汉字，因此用 --text-meta 而不是 --text-badge：
                          徽章字号是拉丁字母与数字的下限，中文压不住。 */}
                      {isVideo && (
                        <span className="photo-wall-video-badge">
                          <PlayFilledIcon size={10} />
                          <span>
                            {videoDuration?.id === item.id
                              ? videoDuration.text
                              : "视频"}
                          </span>
                        </span>
                      )}
                      {/* 精选角标：黑底白勾，与相册级收藏的琥珀色星标
                          形状与颜色都不同 —— 一个说「这张要留」，一个说
                          「这本要留」，两件事不该看着像一件。

                          未精选时不常驻：满墙都是圆点会把照片本身挤掉，
                          悬停才浮出来加号。已精选的则一直挂着。

                          按钮本身有 28px 见方，视觉上的圆点仍是 20px：
                          角标再小也得够得着，触摸设备上 20px 的目标
                          几乎点不中。 */}
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
                          className={`absolute left-0 top-0 z-10 grid place-items-center rounded-full transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                            picked
                              ? "opacity-100"
                              : "hover-reveal group-hover:opacity-100 group-focus-within:opacity-100"
                          }`}
                        >
                          <span className="grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white ring-1 ring-white/25 backdrop-blur">
                            {picked ? (
                              <PickIcon size={12} />
                            ) : (
                              <PlusIcon size={11} />
                            )}
                          </span>
                        </button>
                      )}
                      {/* 多选时的勾选框占同一个角：那一轮用户在做批量操作，
                          精选角标让位，避免两个圆点叠在一起。

                          形状刻意用方框：精选角标是圆的（那是照片的常驻
                          标记），勾选框是方的（那是这一轮的操作状态）。
                          形状与配色都分开，用户不会把「这张在精选里」和
                          「这张被勾上了」看成同一件事。 */}
                      {selecting && onToggleSelect && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleSelect(item);
                          }}
                          role="checkbox"
                          aria-checked={selected}
                          aria-label={`选择「${item.name}」`}
                          title={selected ? "取消选择" : "选择"}
                          className="absolute left-0 top-0 z-10 grid place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        >
                          <span
                            className={`grid h-5 w-5 place-items-center rounded-sm ring-1 transition-colors ${
                              selected
                                ? "bg-accent text-accent-contrast ring-accent"
                                : "bg-black/25 text-white ring-white/60"
                            }`}
                          >
                            {selected && <CheckIcon size={12} />}
                          </span>
                        </button>
                      )}
                      {/* 信息层：文件名与像素尺寸。
                          照片墙是浏览页，光靠缩略图看不出「这是什么」；
                          尺寸来自服务端已带的 width / height，不用另发请求。
                          显隐由 .hover-reveal 管：鼠标设备上悬停才浮出，
                          触摸设备上常驻文件名（像素尺寸是鼠标用户的细节，
                          触摸端收起）。

                          跨相册的墙（年份、精选）显示相册名而不是文件名：
                          那里的照片来自不同的本，用户先要知道自己看的是
                          哪一本里的哪一张。

                          背板用共享的 .scrim-bottom：文字所在的整段保持
                          88% 黑，往上才淡出。原先那层 from-black/85 的渐变
                          在明亮封面上只压到约 52%，白字对比度掉到 4.3:1
                          （AA 要 4.5:1）—— 亮度不可控的封面必须按最坏情况算。 */}
                      <div
                        data-testid="wall-tile-info"
                        className="wall-tile-info pointer-events-none absolute inset-x-0 bottom-0 z-0 flex items-end justify-between gap-2 px-2.5 pb-2 pt-9 scrim-bottom hover-reveal transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
                      >
                        <span className="truncate text-meta text-white">
                          {sourceLabel || item.name}
                        </span>
                        {hasSize && (
                          <span className="mouse-only shrink-0 text-badge tabular-nums text-white/80">
                            {item.width}×{item.height}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
