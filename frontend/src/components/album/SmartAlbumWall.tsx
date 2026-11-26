import { useMemo } from "react";
import type { SmartAlbumDirectoryItem } from "../../api/albums";
import { useElementSize } from "../../hooks/useElementSize";
import { useVisibleWindow } from "../../hooks/useVisibleWindow";
import {
  SMART_ALBUM_COVER_SLOT_RATIO,
  smartAlbumCaptionHeight,
} from "../../utils/smartAlbum";
import {
  layoutMasonry,
  masonryColumnCount,
  type MasonryInput,
} from "../../features/wall/masonryLayout";
import SmartAlbumCard from "./SmartAlbumCard";

interface Props {
  /** 要铺的分组，按给定顺序排。 */
  items: SmartAlbumDirectoryItem[];
  /** 目标列宽（像素）：宽屏上列多、窄屏上列少。 */
  targetColumnWidth?: number;
  /** 列与列之间的间距（像素）。 */
  gap?: number;
  /**
   * 明确的列数，或一个按「按宽度算出来的列数」调整它的函数。
   *
   * 条数少的场合需要列数能整除条数（首页预览只有六张），末行才不是
   * 孤零零一张。
   */
  columns?: number | ((computed: number) => number);
}

const GAP = 10;

/**
 * 智能相册墙：把分组铺成一面等高的方格墙。
 *
 * 槽位是正方形（与相册网格、接着看队列同一套照片侧语言），照片按原比例
 * 完整放进槽里、不裁切，空出来的地方用同一张照片虚化补齐；说明区定高，
 * 因此每张卡一样高，行的底边自然对齐。
 *
 * 渲染按视口裁：一次可能排到四千多组，全量挂进 DOM 会把浏览器拖垮，
 * 因此只有视口附近的那几张真正挂上节点，其余留白。
 */
export default function SmartAlbumWall({
  items,
  targetColumnWidth = 260,
  gap = GAP,
  columns,
}: Props) {
  const {
    ref: containerRef,
    width,
    element,
  } = useElementSize<HTMLDivElement>();

  const inputs = useMemo<MasonryInput[]>(
    () =>
      items.map((item) => ({
        id: `${item.albumId}:${item.group.dimension}:${item.group.id}`,
        ratio: SMART_ALBUM_COVER_SLOT_RATIO,
        extraHeight: smartAlbumCaptionHeight(item),
      })),
    [items],
  );

  const resolvedColumns = useMemo(() => {
    if (!columns) return undefined;
    if (typeof columns === "function") {
      return columns(masonryColumnCount(width, targetColumnWidth, gap));
    }
    return columns;
  }, [columns, width, targetColumnWidth, gap]);

  const layout = useMemo(
    () =>
      layoutMasonry(inputs, {
        containerWidth: width,
        targetColumnWidth,
        gap,
        columns: resolvedColumns,
      }),
    [inputs, width, targetColumnWidth, gap, resolvedColumns],
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
      data-testid="smart-album-wall"
    >
      {tiles.map((tile) => {
        const item = items[tile.index];
        if (!item) return null;
        return (
          <div
            key={tile.id}
            className="absolute"
            style={{
              transform: `translate(${tile.x}px, ${tile.y}px)`,
              width: tile.width,
              height: tile.height,
            }}
          >
            <SmartAlbumCard
              item={item}
              coverHeight={tile.height - smartAlbumCaptionHeight(item)}
              coverWidth={Math.round(tile.width)}
            />
          </div>
        );
      })}
    </div>
  );
}
