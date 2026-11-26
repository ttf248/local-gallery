// 图像库的分组形状（类型定义）。
//
// 分组本身由服务端算好：年份分组来自 /api/library/overview 的 years 字段，
// 作品分组来自 summary.series。前端只负责按这些数据排版，因此这里不再
// 保留客户端侧的分组算法 —— 那份实现（按名字里的 4 位年份解析、递归展开
// 集合子树）早已被服务端取代，留着只会让人以为它是真相源。
//
// 这里保留的是 UI 需要的形状：卡片投影用的轻量结构与两条时间线的数据结构。
import type { CardData } from "../features/library/AlbumTile";
import type { ContentKind } from "../api/library";

export interface YearGroup {
  count?: number;
  /** null 表示「其他」桶（解析不到年份的相册） */
  year: number | null;
  /** 用于 UI 展示：「2024」或「其他」 */
  label: string;
  /** 该组下的所有卡片（album + collection 混合） */
  albums: CardData[];
  /** 文件总数（图片 + 视频），用于副标题「X 个相册 · Y 张」 */
  totalFiles: number;
  /** 图片总数（跨 album + collection 加和），用于 UI 区分图/视频 */
  imageTotal: number;
  /** 视频总数 */
  videoTotal: number;
  /**
   * Top-4 封面拼接源（按文件数倒序后取前 4），用于主页时间线的大年份卡。
   * 可能少于 4 个（空 coverPath 会被 UI 层跳过）。
   */
  coverPreviewPaths: string[];
  /** 与 coverPreviewPaths 一一对应的封面内容版本号。 */
  coverPreviewVersions: string[];
}

// Album 页与分页节点都投影到这两个轻量结构，时间线无需依赖扫描结果树。
export type AlbumLike = {
  path: string;
  name: string;
  imageCount: number;
  videoCount?: number;
  coverImage: string;
  coverImageVersion?: string;
  coverKind?: "image" | "video";
  tags?: string[];
  displayName?: string;
  sourceRoot?: string;
  sourceName?: string;
  virtual?: boolean;
  modTime?: string;
  /** 业务日期（拍摄时间 > 文件夹名日期 > 修改时间）：「按加入时间」排序用它。 */
  date?: string;
  /** 内容属性：决定卡片链接落在哪一侧，也决定要不要显示阅读进度。 */
  contentKind: ContentKind;
};

export type CollectionLike = {
  path: string;
  name: string;
  albumCount: number;
  imageCount?: number;
  videoCount?: number;
  coverImage?: string;
  coverImageVersion?: string;
  coverImages?: string[];
  coverImageVersions?: string[];
  albums?: AlbumLike[];
  collections?: CollectionLike[];
  displayName?: string;
  sourceRoot?: string;
  sourceName?: string;
  /** 业务日期：「按加入时间」排序用它，缺省时退回集合的修改时间。 */
  date?: string;
  /** 内容属性：集合继承所属目录的属性。 */
  contentKind: ContentKind;
};

/**
 * 一组「按连载分」的漫画。
 *
 * 与年份分组不同：漫画常常不以年份命名，一部作品横跨好几年，
 * 按年份分组会把同一部作品拆散在好几处。集合就是作品 ——
 * 服务端把集合的成员聚合成一份「作品数」，前端直接按集合分组。
 */
export interface SeriesGroup {
  /** 稳定键：集合 id；散图那一组用固定值。 */
  key: string;
  /** 展示用的系列名。 */
  label: string;
  /** 进入该系列的链接。 */
  to: string;
  /** 该系列的卷数。 */
  count: number;
  /** 封面（可为空）。 */
  coverPath?: string;
  /** 封面内容版本号。 */
  coverVersion?: string;
}
