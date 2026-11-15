import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SortKey } from "../utils/listFilterParams";

/**
 * 排序偏好。
 *
 * 用户亲手选过的排序对所有列表页生效：挑一次，之后每页都按这个排。
 * 地址里的 `sort` 参数是逐页的显式选择，优先级更高 —— 分享一条链接时
 * 带上的是那一条的排序，不是这一份偏好。
 *
 * 这里只留排序：关键词、视图、年份与最少图数都在地址里，逐页独立。
 */
interface SortPreferenceState {
  /** 用户选过的排序。 */
  sortBy: SortKey;
  /**
   * 用户是否亲手选过排序。
   *
   * 没选过时，各页用各自的天然顺序（首页按名称、浏览足迹按时间）。
   */
  sortTouched: boolean;
  /** 记住新的排序：用户选过就不再回落到天然顺序。 */
  setSortBy: (s: SortKey) => void;
}

export const useSortPreference = create<SortPreferenceState>()(
  persist(
    (set) => ({
      sortBy: "name",
      sortTouched: false,
      setSortBy: (s) => set({ sortBy: s, sortTouched: true }),
    }),
    {
      name: "local-gallery-search",
      // 旧版这里还存着关键词、视图、年份与最少图数；那些现在都在地址里，
      // 迁移时一并丢掉，别让残留在 localStorage 里。
      migrate: (persisted) => {
        const state = persisted as Partial<SortPreferenceState> | undefined;
        if (!state) return state as unknown as SortPreferenceState;
        const sortBy = state.sortBy ?? "name";
        return {
          sortBy,
          sortTouched:
            typeof state.sortTouched === "boolean"
              ? state.sortTouched
              : sortBy !== "name",
        };
      },
    },
  ),
);
