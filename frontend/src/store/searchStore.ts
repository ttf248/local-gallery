// 全局搜索状态：query / 排序 / 视图过滤 / 年份筛选
//
//   - 持久化到 localStorage
//   - 任意页面可读写，Home/Favorites/Recents 共享同一份过滤参数
//   - yearFilter：主页"时间线"点击某年时切换，作用于"全部图像"网格。
//     用 null 表示"未筛选"。注意：年份只对 album 有意义，
//     因此当 view 切到 collection/smart 时应在 UI 层清掉它。
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SortKey = 'name' | 'count' | 'recent' | 'viewed'
export type ViewKey = 'all' | 'album' | 'collection' | 'smart'

interface SearchState {
  query: string
  sortBy: SortKey
  view: ViewKey
  /**
   * 年份筛选：null = 不筛选；number = 精确年份；'other' = "其他"桶。
   * 点时间线上的年份卡时切换（再点同一张 = 取消）；切视图到
   * collection/smart 时由 UI 层清除。
   */
  yearFilter: number | 'other' | null

  setQuery: (q: string) => void
  setSortBy: (s: SortKey) => void
  setView: (v: ViewKey) => void
  setYearFilter: (y: number | 'other' | null) => void
  toggleYearFilter: (y: number | 'other') => void
  reset: () => void
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
      query: '',
      sortBy: 'name',
      // 默认 'all'，但用户最常看的是文件夹；提供 reset 入口可一键回到默认
      view: 'all',
      yearFilter: null,
      setQuery: (q) => set({ query: q }),
      setSortBy: (s) => set({ sortBy: s }),
      setView: (v) => set({ view: v }),
      setYearFilter: (y) => set({ yearFilter: y }),
      toggleYearFilter: (y) =>
        set({ yearFilter: get().yearFilter === y ? null : y }),
      reset: () =>
        set({ query: '', sortBy: 'name', view: 'all', yearFilter: null }),
    }),
    {
      name: 'local-gallery-search',
    },
  ),
)
