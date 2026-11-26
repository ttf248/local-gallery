import type { CardData } from "../features/library/AlbumTile";
import type { SelectionItem } from "../store/selectionStore";
import { decodeFavPath, favoriteResourceId } from "./path";

/**
 * 卡片 → 批量选择条目。
 *
 * 网格内部与页面外部都要用这一份推导（网格用它渲染选择卡，页面用它
 * 渲染批量动作条），各写一遍就会在「已加载项」的范围上分叉：网格里
 * 只有一段，页面里是整页，两边选中的集合不一样。
 */
export function toSelectionItems(items: CardData[]): SelectionItem[] {
  return items.map((card) => ({
    id: favoriteResourceId(card),
    albumId: card.variant === "album" ? decodeFavPath(card.to) : undefined,
    title: card.title,
    contentKind: card.contentKind,
    imageCount: card.imageCount ?? 0,
  }));
}
