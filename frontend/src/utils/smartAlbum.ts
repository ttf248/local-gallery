import type { SmartAlbumDirectoryItem } from "../api/albums";
import { albumRoute } from "./path";

/**
 * 智能相册卡片里封面之下那块说明区的高度（像素）。
 *
 * 瀑布流按「封面高度 + 这块高度」算卡片的位置，因此这块必须是定高的：
 * 标题与来源各占一行，行高写死，名字再长也只截断不换行 ——
 * 换行会让卡片高度飘，瀑布流就会错位。
 */
export const SMART_ALBUM_CAPTION_HEIGHT = 52;
export const SMART_ALBUM_RECOMMENDATION_CAPTION_HEIGHT = 68;

export function smartAlbumCaptionHeight(item: SmartAlbumDirectoryItem): number {
  return item.group.dimension === "recommended"
    ? SMART_ALBUM_RECOMMENDATION_CAPTION_HEIGHT
    : SMART_ALBUM_CAPTION_HEIGHT;
}

/** 分组卡片的去处：来源相册里的那个分组。 */
export function smartGroupHref(item: SmartAlbumDirectoryItem): string {
  const query = new URLSearchParams({
    view: "smart",
    dimension: item.group.dimension,
    group: item.group.id,
  });
  return `${albumRoute("photo", item.albumId)}?${query.toString()}`;
}
