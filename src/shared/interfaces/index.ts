// =============================================================================
// 数据模型接口
// =============================================================================

export interface Collection {
  id: string
  name: string
  author: string
  totalChapters: number
  coverPath: string
  tags: string[]
  rating: number
  lastUpdated: string
}

export interface Chapter {
  id: string
  collectionId: string
  index: number
  title: string
  path: string
  pages: string[]
  totalPages: number
  lastReadAt?: string
  read: boolean
}

export interface ReadingProgress {
  collectionId: string
  chapterIndex: number
  currentPage: number
  lastReadAt: string
}

export interface HistoryEntry {
  collectionId: string
  timestamp: string
}

export interface FavoriteEntry {
  collectionId: string
  addedAt: string
}

export interface ComicData {
  collections: Collection[]
  chapters: Chapter[]
  readingProgress: ReadingProgress[]
  history: HistoryEntry[]
  favorites: FavoriteEntry[]
}

// =============================================================================
// 阅读器相关接口
// =============================================================================

export interface ZoomMode {
  type: 'fit-width' | 'fit-height' | 'actual-size' | 'custom'
  scale?: number
}

export interface ReaderSettings {
  pageDirection: 'rtl' | 'ltr'
  mouseWheelEnabled: boolean
  transitionAnimation: boolean
  defaultZoom: ZoomMode
  zoomSensitivity: number
  autoReading: {
    enabled: boolean
    interval: number
  }
  continuousReading: {
    enabled: boolean
    autoNextChapter: boolean
    transitionDelay: number
    showTransitionMessage: boolean
  }
}

export interface DisplaySettings {
  theme: 'light' | 'dark'
  gridColumns: number
  thumbnailSize: number
  fullscreenOnOpen: boolean
  collectionDisplay: {
    showCollectionBadge: boolean
    showLastReadChapter: boolean
    groupByCollection: boolean
  }
}

export interface ShortcutConfig {
  nextPage: string[]
  prevPage: string[]
  zoomIn: string[]
  zoomOut: string[]
  fullscreen: string[]
  nextChapter: string[]
  prevChapter: string[]
}

export interface StorageSettings {
  cachePath: string
  maxCacheSize: string
  autoCleanup: boolean
}

export interface AppSettings {
  reading: ReaderSettings
  display: DisplaySettings
  shortcuts: ShortcutConfig
  storage: StorageSettings
}

// =============================================================================
// 文件扫描相关接口
// =============================================================================

export interface ImageFile {
  path: string
  name: string
  size: number
  modified: Date
}

export interface Directory {
  path: string
  name: string
  isDirectory: boolean
  children?: Directory[]
}

export interface ScanResult {
  collections: Collection[]
  chapters: Chapter[]
  totalScanned: number
  scanTime: number
}

// =============================================================================
// API 响应接口
// =============================================================================

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// =============================================================================
// 组件 Props 接口
// =============================================================================

export interface ComicCardProps {
  collection: Collection
  onClick?: () => void
  onFavorite?: (id: string) => void
  onRead?: (id: string) => void
}

export interface NavigationItem {
  key: string
  icon: string
  text: string
  count?: number
  color?: string
  active?: boolean
}

export interface TagItem {
  text: string
  color: string
}

// =============================================================================
// 工具类型
// =============================================================================

export type Theme = 'light' | 'dark'

export type ViewMode = 'grid' | 'list'

export type SortOption = 'relevance' | 'latest' | 'rating' | 'pageCount'

export type ReadingStatus = 'all' | 'notStarted' | 'reading' | 'completed'

export type FilterCriteria = {
  status?: ReadingStatus
  rating?: number
  tags?: string[]
  pageRange?: {
    min: number
    max: number
  }
}
