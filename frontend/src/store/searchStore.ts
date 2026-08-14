// 全局搜索状态：query / 排序 / 视图过滤
//
//   - 持久化到 localStorage
//   - 任意页面可读写，Home/Favorites/Recents 共享同一份过滤参数
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SortKey = 'name' | 'count' | 'recent'
export type ViewKey = 'all' | 'album' | 'collection' | 'smart'

interface SearchState {
  query: string
  sortBy: SortKey
  view: ViewKey

  setQuery: (q: string) => void
  setSortBy: (s: SortKey) => void
  setView: (v: ViewKey) => void
  reset: () => void
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set) => ({
      query: '',
      sortBy: 'name',
      view: 'all',
      setQuery: (q) => set({ query: q }),
      setSortBy: (s) => set({ sortBy: s }),
      setView: (v) => set({ view: v }),
      reset: () => set({ query: '', sortBy: 'name', view: 'all' }),
    }),
    {
      name: 'comic-reader-search',
    },
  ),
)
