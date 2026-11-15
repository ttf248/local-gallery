import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useSortPreference } from "../store/sortPreference";
import {
  LIST_PARAM,
  parseMin,
  parseSort,
  parseView,
  parseYear,
  type SortKey,
  type ViewKey,
} from "../utils/listFilterParams";

export interface ListFiltersOptions {
  /**
   * 这一页的天然排序。
   *
   * 地址里没有 sort、用户也没亲手选过排序时用它。浏览足迹页用它
   * 「按最近看」：那一页问的是「我刚才在翻什么」，按名称排会把时刻
   * 打乱，左边那一列时间就不再是一条轴。
   */
  defaultSort?: SortKey;
}

export interface ListFilters {
  /** 关键词。空串表示不过滤。 */
  query: string;
  setQuery: (q: string) => void;
  /** 生效的排序：地址里的显式选择优先，其次是用户的偏好，最后是天然顺序。 */
  sortBy: SortKey;
  setSortBy: (s: SortKey) => void;
  /** 最少图数：0 表示不过滤。 */
  minImageCount: number;
  setMinImageCount: (n: number) => void;
  /** 视图筛选。 */
  view: ViewKey;
  setView: (v: ViewKey) => void;
  /** 年份筛选：null 表示不过滤。 */
  yearFilter: number | "other" | null;
  setYearFilter: (y: number | "other" | null) => void;
  toggleYearFilter: (y: number | "other") => void;
  /** 清掉这一页的全部筛选。 */
  reset: () => void;
}

/**
 * 列表页的筛选状态：地址里的查询参数。
 *
 * 筛选放在地址里，链接可以分享，浏览器后退能取消筛选，刷新也不会丢。
 * 排序另有一层：用户亲手选过的顺序对所有列表页生效，作为「地址里没有
 * sort」时的回落。
 */
export function useListFilters(
  options: ListFiltersOptions = {},
): ListFilters {
  const { defaultSort = "name" } = options;
  const [params, setParams] = useSearchParams();
  const sortBy = useSortPreference((s) => s.sortBy);
  const sortTouched = useSortPreference((s) => s.sortTouched);
  const setSortPreference = useSortPreference((s) => s.setSortBy);

  const query = params.get(LIST_PARAM.query) ?? "";
  const sort = parseSort(params.get(LIST_PARAM.sort));
  const minImageCount = parseMin(params.get(LIST_PARAM.min));
  const view = parseView(params.get(LIST_PARAM.view));
  const yearFilter = parseYear(params.get(LIST_PARAM.year));

  // 写回地址。replace 用于「连续发生」的动作（敲字、改数字）：
  // 每敲一个字塞一条历史，后退键就退不出输入框。
  const setParam = useCallback(
    (key: string, value: string | null, replace: boolean) => {
      const next = new URLSearchParams(params);
      if (value === null) next.delete(key);
      else next.set(key, value);
      if (next.toString() === params.toString()) return;
      setParams(next, { replace });
    },
    [params, setParams],
  );

  const setQuery = useCallback(
    (q: string) => setParam(LIST_PARAM.query, q || null, true),
    [setParam],
  );

  const setSortBy = useCallback(
    (s: SortKey) => {
      // 排序写进地址（逐页的显式选择），也记住为跨页偏好：没带 sort 的
      // 那一页仍按用户挑过的顺序排。
      setParam(LIST_PARAM.sort, s, false);
      setSortPreference(s);
    },
    [setParam, setSortPreference],
  );

  const setMinImageCount = useCallback(
    (n: number) => {
      const value = Math.max(0, Math.floor(n));
      setParam(LIST_PARAM.min, value ? String(value) : null, true);
    },
    [setParam],
  );

  const setView = useCallback(
    (v: ViewKey) =>
      setParam(LIST_PARAM.view, v === "all" ? null : v, false),
    [setParam],
  );

  const setYearFilter = useCallback(
    (y: number | "other" | null) =>
      setParam(LIST_PARAM.year, y === null ? null : String(y), false),
    [setParam],
  );

  const toggleYearFilter = useCallback(
    (y: number | "other") => {
      setYearFilter(yearFilter === y ? null : y);
    },
    [setYearFilter, yearFilter],
  );

  const reset = useCallback(() => {
    const next = new URLSearchParams(params);
    for (const key of Object.values(LIST_PARAM)) next.delete(key);
    if (next.toString() === params.toString()) return;
    setParams(next, { replace: true });
  }, [params, setParams]);

  return {
    query,
    setQuery,
    sortBy: sort ?? (sortTouched ? sortBy : defaultSort),
    setSortBy,
    minImageCount,
    setMinImageCount,
    view,
    setView,
    yearFilter,
    setYearFilter,
    toggleYearFilter,
    reset,
  };
}
