// =============================================================================
// 主题枚举
// =============================================================================

export enum Theme {
  Light = 'light',
  Dark = 'dark',
}

// =============================================================================
// 视图模式枚举
// =============================================================================

export enum ViewMode {
  Grid = 'grid',
  List = 'list',
}

// =============================================================================
// 排序选项枚举
// =============================================================================

export enum SortOption {
  Relevance = 'relevance',
  Latest = 'latest',
  Rating = 'rating',
  PageCount = 'pageCount',
}

// =============================================================================
// 阅读状态枚举
// =============================================================================

export enum ReadingStatus {
  All = 'all',
  NotStarted = 'notStarted',
  Reading = 'reading',
  Completed = 'completed',
}

// =============================================================================
// 缩放模式枚举
// =============================================================================

export enum ZoomMode {
  FitWidth = 'fit-width',
  FitHeight = 'fit-height',
  ActualSize = 'actual-size',
  Custom = 'custom',
}

// =============================================================================
// 翻页方向枚举
// =============================================================================

export enum PageDirection {
  RightToLeft = 'rtl',
  LeftToRight = 'ltr',
}

// =============================================================================
// 文件类型枚举
// =============================================================================

export enum FileType {
  Image = 'image',
  Directory = 'directory',
  Other = 'other',
}

// =============================================================================
// 支持的图片格式枚举
// =============================================================================

export enum ImageFormat {
  JPG = 'jpg',
  JPEG = 'jpeg',
  PNG = 'png',
  GIF = 'gif',
  WEBP = 'webp',
  BMP = 'bmp',
  TIFF = 'tiff',
}

// =============================================================================
// 通知类型枚举
// =============================================================================

export enum NotificationType {
  Info = 'info',
  Success = 'success',
  Warning = 'warning',
  Error = 'error',
}

// =============================================================================
// 对话框类型枚举
// =============================================================================

export enum DialogType {
  Confirm = 'confirm',
  Alert = 'alert',
  Prompt = 'prompt',
}

// =============================================================================
// 事件类型枚举 (用于 IPC)
// =============================================================================

export enum IpcEvent {
  // 文件扫描事件
  SCAN_START = 'scan:start',
  SCAN_PROGRESS = 'scan:progress',
  SCAN_COMPLETE = 'scan:complete',
  SCAN_ERROR = 'scan:error',

  // 数据管理事件
  DATA_LOAD = 'data:load',
  DATA_SAVE = 'data:save',
  DATA_UPDATE = 'data:update',

  // 窗口管理事件
  WINDOW_MINIMIZE = 'window:minimize',
  WINDOW_MAXIMIZE = 'window:maximize',
  WINDOW_CLOSE = 'window:close',
  WINDOW_FULLSCREEN = 'window:fullscreen',

  // 设置事件
  SETTINGS_GET = 'settings:get',
  SETTINGS_SET = 'settings:set',
  SETTINGS_RESET = 'settings:reset',
}

// =============================================================================
// 错误类型枚举
// =============================================================================

export enum ErrorType {
  ValidationError = 'validation',
  NetworkError = 'network',
  FileSystemError = 'filesystem',
  PermissionError = 'permission',
  UnknownError = 'unknown',
}

// =============================================================================
// 操作类型枚举 (用于历史记录)
// =============================================================================

export enum ActionType {
  Import = 'import',
  Delete = 'delete',
  Read = 'read',
  Favorite = 'favorite',
  Unfavorite = 'unfavorite',
  Update = 'update',
}

// =============================================================================
// 缩放级别枚举 (用于快捷键)
// =============================================================================

export enum ZoomLevel {
  Small = 0.5,
  Medium = 1.0,
  Large = 1.5,
  ExtraLarge = 2.0,
}

// =============================================================================
// 阅读模式枚举
// =============================================================================

export enum ReadingMode {
  Single = 'single',     // 单页模式
  Double = 'double',     // 双页模式
  Continuous = 'continuous', // 连续滚动模式
}

// =============================================================================
// 语言枚举
// =============================================================================

export enum Language {
  Chinese = 'zh-CN',
  English = 'en-US',
  Japanese = 'ja-JP',
}

// =============================================================================
// 平台枚举
// =============================================================================

export enum Platform {
  Windows = 'win32',
  macOS = 'darwin',
  Linux = 'linux',
}

// =============================================================================
// 窗口状态枚举
// =============================================================================

export enum WindowState {
  Normal = 'normal',
  Maximized = 'maximized',
  Minimized = 'minimized',
  Fullscreen = 'fullscreen',
}

// =============================================================================
// 进度状态枚举
// =============================================================================

export enum ProgressStatus {
  NotStarted = 'notStarted',
  InProgress = 'inProgress',
  Completed = 'completed',
  Paused = 'paused',
}

// =============================================================================
// 筛选器类型枚举
// =============================================================================

export enum FilterType {
  ReadingStatus = 'readingStatus',
  Rating = 'rating',
  Tags = 'tags',
  PageRange = 'pageRange',
  Author = 'author',
  Collection = 'collection',
}

// =============================================================================
// 排序方向枚举
// =============================================================================

export enum SortDirection {
  Ascending = 'asc',
  Descending = 'desc',
}

// =============================================================================
// 分页类型枚举
// =============================================================================

export enum PaginationType {
  PageNumber = 'pageNumber',
  Infinite = 'infinite',
  LoadMore = 'loadMore',
}
