import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  Collection,
  Chapter,
  ReadingProgress,
  ViewMode,
  SortOption,
  FilterCriteria,
} from '@shared/interfaces'
import { dataManager } from '../../services/database'

export interface ComicState {
  // 数据
  collections: Collection[]
  chapters: Chapter[]
  readingProgress: Map<string, ReadingProgress>
  favorites: Set<string>

  // UI 状态
  currentView: ViewMode
  sortBy: SortOption
  searchKeyword: string
  filter: FilterCriteria

  // 加载状态
  isLoading: boolean
  error: string | null

  // 操作方法
  loadData: () => Promise<void>
  setCollections: (collections: Collection[]) => void
  setChapters: (chapters: Chapter[]) => void
  setCurrentView: (view: ViewMode) => void
  setSortBy: (sort: SortOption) => void
  setSearchKeyword: (keyword: string) => void
  setFilter: (filter: FilterCriteria) => void
  clearFilter: () => void
  toggleFavorite: (collectionId: string) => Promise<void>
  saveProgress: (
    collectionId: string,
    chapterIndex: number,
    page: number
  ) => Promise<void>
  getFilteredCollections: () => Collection[]
}

export const useComicStore = create<ComicState>()(
  devtools(
    (set, get) => ({
      // 初始状态
      collections: [],
      chapters: [],
      readingProgress: new Map(),
      favorites: new Set(),
      currentView: 'grid',
      sortBy: 'relevance',
      searchKeyword: '',
      filter: {},
      isLoading: false,
      error: null,

      // 加载数据
      loadData: async () => {
        set({ isLoading: true, error: null })
        try {
          const result = await dataManager.loadData()
          if (result.success && result.data) {
            // 转换 Map 和 Set
            const progressMap = new Map(
              result.data.readingProgress.map(p => [p.collectionId, p])
            )
            const favoriteSet = new Set(
              result.data.favorites.map(f => f.collectionId)
            )

            set({
              collections: result.data.collections,
              chapters: result.data.chapters,
              readingProgress: progressMap,
              favorites: favoriteSet,
              isLoading: false,
            })
          } else {
            set({
              error: result.error || '加载数据失败',
              isLoading: false,
            })
          }
        } catch (error) {
          set({
            error: '加载数据时发生错误',
            isLoading: false,
          })
        }
      },

      // 设置合集列表
      setCollections: (collections) => {
        set({ collections })
      },

      // 设置章节列表
      setChapters: (chapters) => {
        set({ chapters })
      },

      // 设置视图模式
      setCurrentView: (view) => {
        set({ currentView: view })
      },

      // 设置排序方式
      setSortBy: (sort) => {
        set({ sortBy: sort })
      },

      // 设置搜索关键词
      setSearchKeyword: (keyword) => {
        set({ searchKeyword: keyword })
      },

      // 设置筛选条件
      setFilter: (filter) => {
        set({ filter: { ...get().filter, ...filter } })
      },

      // 清除筛选条件
      clearFilter: () => {
        set({ filter: {} })
      },

      // 切换收藏状态
      toggleFavorite: async (collectionId) => {
        try {
          const result = await dataManager.toggleFavorite(collectionId)
          if (result.success) {
            const favorites = new Set(get().favorites)
            if (result.data) {
              favorites.add(collectionId)
            } else {
              favorites.delete(collectionId)
            }
            set({ favorites })
          }
        } catch (error) {
          console.error('切换收藏状态失败:', error)
        }
      },

      // 保存阅读进度
      saveProgress: async (collectionId, chapterIndex, page) => {
        try {
          await dataManager.saveProgress(collectionId, chapterIndex, page)
          // 更新本地状态
          const progressMap = new Map(get().readingProgress)
          progressMap.set(collectionId, {
            collectionId,
            chapterIndex,
            currentPage: page,
            lastReadAt: new Date().toISOString(),
          })
          set({ readingProgress: progressMap })
        } catch (error) {
          console.error('保存阅读进度失败:', error)
        }
      },

      // 获取筛选后的合集列表
      getFilteredCollections: () => {
        const { collections, searchKeyword, filter, sortBy } = get()

        // 搜索筛选
        let filtered = collections

        if (searchKeyword) {
          const keyword = searchKeyword.toLowerCase()
          filtered = filtered.filter(
            c =>
              c.name.toLowerCase().includes(keyword) ||
              c.author.toLowerCase().includes(keyword) ||
              c.tags.some(tag => tag.toLowerCase().includes(keyword))
          )
        }

        // 状态筛选
        if (filter.status && filter.status !== 'all') {
          // 这里可以根据阅读状态进行筛选
          // 需要结合 readingProgress 来判断
        }

        // 评分筛选
        if (filter.rating) {
          filtered = filtered.filter(c => c.rating >= filter.rating!)
        }

        // 标签筛选
        if (filter.tags && filter.tags.length > 0) {
          filtered = filtered.filter(c =>
            filter.tags!.some(tag => c.tags.includes(tag))
          )
        }

        // 页数范围筛选
        if (filter.pageRange) {
          const { min, max } = filter.pageRange
          filtered = filtered.filter(c => {
            const totalPages = get()
              .chapters
              .filter(ch => ch.collectionId === c.id)
              .reduce((sum, ch) => sum + ch.totalPages, 0)
            return totalPages >= min && totalPages <= max
          })
        }

        // 排序
        switch (sortBy) {
          case 'relevance':
            // 搜索相关性排序（保持原始顺序）
            break
          case 'latest':
            filtered.sort(
              (a, b) =>
                new Date(b.lastUpdated).getTime() -
                new Date(a.lastUpdated).getTime()
            )
            break
          case 'rating':
            filtered.sort((a, b) => b.rating - a.rating)
            break
          case 'pageCount':
            filtered.sort((a, b) => {
              const aPages = get()
                .chapters
                .filter(ch => ch.collectionId === a.id)
                .reduce((sum, ch) => sum + ch.totalPages, 0)
              const bPages = get()
                .chapters
                .filter(ch => ch.collectionId === b.id)
                .reduce((sum, ch) => sum + ch.totalPages, 0)
              return bPages - aPages
            })
            break
        }

        return filtered
      },
    }),
    {
      name: 'comic-store', // 命名空间，便于 Redux DevTools
    }
  )
)
