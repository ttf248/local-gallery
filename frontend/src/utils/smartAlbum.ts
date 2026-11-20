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

/**
 * 主题封面的**槽位**比例（宽 / 高 = 1）。
 *
 * 照片侧的封面画幅一律方形：相册网格、接着看队列、那年今日、年份卡都是。
 * 智能相册的槽位跟同一套语言，理由不止是统一 —— 主题封面的真实比例
 * 散得很开（实测 0.56 到 1.78），按真实比例排会让同一行的卡片高度差
 * 三倍，底边参差不齐、中间留洞。槽位固定成方形后每张卡一样高，行自然对齐。
 *
 * 槽位是方的，**照片不是被裁成方的**：照片按原比例完整放进槽里，空出来
 * 的地方用同一张照片放大虚化补齐（见 `components/album/SmartAlbumCover.tsx`）。
 * 早期版本用 object-cover 把照片裁成方形，竖幅照片因此被切掉上下大半。
 */
export const SMART_ALBUM_COVER_SLOT_RATIO = 1;

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
  // 分组是相册里照片的一种看法，不是另一本相册：地址里只有分组维度与
  // 选中的那一组，没有「换个相册」的开关。
  const query = new URLSearchParams({
    dimension: item.group.dimension,
    group: item.group.id,
  });
  return `${albumRoute("photo", item.albumId)}?${query.toString()}`;
}

/**
 * 首页预览的列数要能整除卡片数。
 *
 * 列数本来按容器宽度算：1600px 宽算出 5 列、2300px 算出 7 列，
 * 六张卡摊进去就成了「五张 + 一张」的孤行。这里在能整除卡片数的因数里
 * 挑一个不超过算出值的最大的；挑不出来（卡片数是素数、而列数只有一两列）
 * 就按算出的列数来 —— 宁可末行不满，也不要为凑整把卡挤成一列。
 */
export function smartAlbumPreviewColumns(
  computed: number,
  count: number,
): number {
  if (count <= 0) return computed;
  for (let columns = Math.min(computed, count); columns >= 2; columns -= 1) {
    if (count % columns === 0) return columns;
  }
  return computed;
}
