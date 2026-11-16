import { useMemo } from "react";
import type { SmartAlbumDirectoryItem } from "../../api/albums";
import { useElementSize } from "../../hooks/useElementSize";
import { useVisibleWindow } from "../../hooks/useVisibleWindow";
import { SMART_ALBUM_CAPTION_HEIGHT } from "../../utils/smartAlbum";
import {
  DEFAULT_MASONRY_RATIO,
  layoutMasonry,
  type MasonryInput,
} from "../wall/masonryLayout";
import SmartAlbumCard from "./SmartAlbumCard";

interface Props {
  /** 要铺的分组，按给定顺序排。 */
  items: SmartAlbumDirectoryItem[];
  /** 目标列宽（像素）：宽屏上列多、窄屏上列少。 */
  targetColumnWidth?: number;
  /** 列与列之间的间距（像素）。 */
  gap?: number;
}

const GAP = 10;

/**
 * 智能相册墙：把分组按封面的真实比例铺成瀑布流。
 *
 * 与照片墙（PhotoMasonry）同源，但排的是卡片：卡片高度 = 封面高度 +
 * 定高的说明区，因此每张卡片落在当前最矮的那一列。
 *
 * 渲染按视口裁：一次可能排到四千多组，全量挂进 DOM 会把浏览器拖垮，
 * 因此只有视口附近的那几张真正挂上节点，其余留白。
 */
export default function SmartAlbumWall({
  items,
  targetColumnWidth = 260,
  gap = GAP,
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
        ratio: coverRatio(item),
        extraHeight: SMART_ALBUM_CAPTION_HEIGHT,
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
              coverHeight={tile.height - SMART_ALBUM_CAPTION_HEIGHT}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * 封面图的宽高比。
 *
 * 服务端给得出封面的原始像素尺寸就用它 —— 竖幅照片占着竖的位置，
 * 墙面才参差。尺寸未知（老缓存或读不出图片头）就退回默认比例。
 */
function coverRatio(item: SmartAlbumDirectoryItem): number {
  const group = item.group;
  if (!group.coverWidth || !group.coverHeight) return DEFAULT_MASONRY_RATIO;
  return group.coverWidth / group.coverHeight;
}
