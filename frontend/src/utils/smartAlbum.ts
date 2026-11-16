import type {
  SmartAlbumDimension,
  SmartAlbumDirectoryItem,
} from "../api/albums";
import { albumRoute } from "./path";

/**
 * 智能相册卡片里封面之下那块说明区的高度（像素）。
 *
 * 瀑布流按「封面高度 + 这块高度」算卡片的位置，因此这块必须是定高的：
 * 标题与来源各占一行，行高写死，名字再长也只截断不换行 ——
 * 换行会让卡片高度飘，瀑布流就会错位。
 *
 * 口径是「内容高度 + 上下内边距」：
 * 普通维度 20（标题）+ 4 + 16（来源）+ 8 + 4 = 52；
 * 推荐维度多一行证据芯片（18）= 74。改这个数要连带核对卡片实际渲染高度。
 */
export const SMART_ALBUM_CAPTION_HEIGHT = 52;
export const SMART_ALBUM_RECOMMENDATION_CAPTION_HEIGHT = 74;

/** 维度在界面上的短标签。角标与证据芯片共用一份，不会各说各话。 */
export const SMART_ALBUM_DIMENSION_LABELS: Record<SmartAlbumDimension, string> =
  {
    recommended: "推荐",
    time: "时间",
    place: "地点",
    people: "人物",
    scene: "场景",
  };

/**
 * 证据线索的固定顺序，与后端 `orderSmartEvidenceDimensions` 一致。
 *
 * 「推荐」本身不是证据 —— 推荐是证据组合出来的结果，所以这里只列
 * 时间、地点、人物、场景四类详细维度。
 */
export const SMART_ALBUM_EVIDENCE_ORDER: readonly SmartAlbumDimension[] = [
  "time",
  "place",
  "people",
  "scene",
];

export function smartAlbumCaptionHeight(item: SmartAlbumDirectoryItem): number {
  return item.group.dimension === "recommended"
    ? SMART_ALBUM_RECOMMENDATION_CAPTION_HEIGHT
    : SMART_ALBUM_CAPTION_HEIGHT;
}

/**
 * 一条推荐由哪几类线索支撑。
 *
 * 后端把支撑推荐的四类维度放在 `evidenceDimensions` 里，顺序已经固定；
 * 这里再排一次并去重，是为了老缓存里顺序不对时也能摆齐。
 */
export function smartAlbumEvidenceDimensions(group: {
  evidenceDimensions?: SmartAlbumDimension[];
}): SmartAlbumDimension[] {
  const present = new Set(group.evidenceDimensions ?? []);
  return SMART_ALBUM_EVIDENCE_ORDER.filter((dimension) =>
    present.has(dimension),
  );
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
