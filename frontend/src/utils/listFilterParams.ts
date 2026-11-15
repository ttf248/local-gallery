/**
 * 列表筛选参数的解析与序列化。
 *
 * 筛选状态放在地址里：链接可以分享，浏览器后退能取消筛选，刷新页面
 * 也不会丢。参数名只有这一处定义，解析与拼装也只有这一份实现。
 */

/**
 * 排序口径。
 *
 * - name   按名称
 * - count  按张数（漫画侧按页数）
 * - recent 按最近改（文件修改时间）
 * - added  按加入时间（业务日期：拍摄时间 > 文件夹名日期 > 修改时间，
 *          与后端「最近加入」同一口径）
 * - viewed 按最近看（访问记录）
 */
export type SortKey = "name" | "count" | "recent" | "added" | "viewed";

/** 视图筛选：全部 / 文件夹 / 集合 / 标签。 */
export type ViewKey = "all" | "album" | "collection" | "smart";

/** 地址参数名。 */
export const LIST_PARAM = {
  query: "q",
  sort: "sort",
  min: "min",
  view: "view",
  year: "year",
} as const;

const SORT_KEYS: readonly SortKey[] = [
  "name",
  "count",
  "recent",
  "added",
  "viewed",
];
const VIEW_KEYS: readonly ViewKey[] = ["all", "album", "collection", "smart"];

/** 解析排序参数；认不出的值当作没有（用这一页的天然顺序）。 */
export function parseSort(raw: string | null): SortKey | null {
  return raw !== null && SORT_KEYS.includes(raw as SortKey)
    ? (raw as SortKey)
    : null;
}

/** 解析视图参数；认不出的值当作「全部」。 */
export function parseView(raw: string | null): ViewKey {
  return raw !== null && VIEW_KEYS.includes(raw as ViewKey)
    ? (raw as ViewKey)
    : "all";
}

/** 解析最少图数；认不出的值当作不过滤（0）。 */
export function parseMin(raw: string | null): number {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** 解析年份筛选；null 表示不过滤。 */
export function parseYear(raw: string | null): number | "other" | null {
  if (!raw) return null;
  if (raw === "other") return "other";
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}
