// =============================================================================
// 颜色常量 - 与原型图保持一致
// =============================================================================

export const COLORS = {
  // 主色调
  primary: '#4A90E2',
  primaryHover: '#357ABD',

  // 背景色
  background: '#F8F9FA',
  surface: '#FFFFFF',
  border: '#E9ECEF',

  // 文本色
  text: '#2C3E50',
  textMuted: '#6C757D',

  // 语义色
  success: '#50C878',
  error: '#E74C3C',
  warning: '#F39C12',
  info: '#3498DB',
} as const

// =============================================================================
// 布局常量
// =============================================================================

export const LAYOUT = {
  // 侧边栏宽度
  sidebarWidth: 256, // w-64

  // 筛选面板宽度
  filterPanelWidth: 288, // w-72

  // 顶部栏高度
  topBarHeight: 80, // py-6 (24px * 2) + 文字大小

  // 底部栏高度
  bottomBarHeight: 72, // py-4 (16px * 2) + 按钮高度

  // 网格列数
  gridColumns: 6,

  // 网格间距
  gridGap: 20, // gap-5
} as const

// =============================================================================
// 间距常量 (与 Tailwind 一致)
// =============================================================================

export const SPACING = {
  xs: 4,   // 0.25rem
  sm: 8,   // 0.5rem
  md: 12,  // 0.75rem
  lg: 16,  // 1rem
  xl: 20,  // 1.25rem
  '2xl': 24, // 1.5rem
  '3xl': 32, // 2rem
  '4xl': 40, // 2.5rem
  '5xl': 48, // 3rem
} as const

// =============================================================================
// 字体常量
// =============================================================================

export const FONT = {
  family: [
    'Inter',
    'system-ui',
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'PingFang SC',
    'Hiragino Sans GB',
    'Microsoft YaHei',
    'sans-serif'
  ],
  size: {
    xs: '12px',    // text-xs
    sm: '14px',    // text-sm
    base: '16px',  // text-base
    lg: '18px',    // text-lg
    xl: '20px',    // text-xl
    '2xl': '24px', // text-2xl
  },
  weight: {
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const

// =============================================================================
// 圆角常量
// =============================================================================

export const BORDER_RADIUS = {
  sm: 4,   // rounded-sm
  md: 6,   // rounded-md
  lg: 8,   // rounded-lg
  xl: 12,  // rounded-xl
  full: 9999, // rounded-full
} as const

// =============================================================================
// 动画常量
// =============================================================================

export const ANIMATION = {
  duration: {
    fast: 150,   // 0.15s
    normal: 200, // 0.2s
    slow: 300,   // 0.3s
  },
  easing: {
    ease: 'ease',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    easeInOut: 'ease-in-out',
  },
} as const

// =============================================================================
// 文件路径常量
// =============================================================================

export const PATHS = {
  // 获取用户数据目录 - 使用函数延迟求值避免渲染进程错误
  get userData(): string {
    // 在渲染进程中，使用window.api获取路径
    if (typeof window !== 'undefined' && (window as any).api?.getPath) {
      return (window as any).api.getPath('userData')
    }
    // 开发环境或主进程中使用默认值
    return ''
  },

  // 应用数据目录
  appData: '', // 将在运行时动态设置

  // 缓存目录
  cache: '', // 将在运行时动态设置

  // 设置文件
  settingsFile: 'settings.json',

  // 数据文件
  dataFile: 'data.json',
} as const

// =============================================================================
// 分页常量
// =============================================================================

export const PAGINATION = {
  defaultPageSize: 24, // 4行 * 6列
  pageSizeOptions: [12, 24, 48, 96],
  maxPageButtons: 7, // 显示的最大页码按钮数
} as const

// =============================================================================
// 性能常量
// =============================================================================

export const PERFORMANCE = {
  // 虚拟滚动阈值
  virtualScrollThreshold: 100,

  // 图片懒加载阈值
  lazyLoadThreshold: 0.1, // 10%

  // 预加载图片数量
  preloadImageCount: 3,

  // 缩略图尺寸
  thumbnailSize: {
    width: 200,
    height: 267, // 3:4 比例
  },

  // 缓存限制
  maxCacheSize: 50 * 1024 * 1024, // 50MB
  maxCacheItems: 1000,
} as const

// =============================================================================
// 合集识别常量
// =============================================================================

export const COLLECTION_DETECTION = {
  // 最少章节数
  minChaptersForCollection: 2,

  // 支持的章节模式
  chapterPatterns: [
    /第(\d+)话/,
    /第(\d+)集/,
    /Vol\.(\d+)/i,
    /第(\d+)卷/,
    /Chapter\s+(\d+)/i,
  ],

  // 常见漫画名称模式
  namePatterns: [
    /^(.*?)(?:\s*第\d+[话集卷]|Vol\.\d+|Chapter\s+\d+)?$/i,
    /^(.*?)\s*-\s*第\d+[话集卷]?$/i,
  ],
} as const

// =============================================================================
// 阅读设置常量
// =============================================================================

export const READING_CONFIG = {
  // 翻页方向
  pageDirection: {
    RTL: 'rtl', // 从右到左
    LTR: 'ltr', // 从左到右
  } as const,

  // 缩放模式
  zoomModes: {
    fitWidth: 'fit-width',
    fitHeight: 'fit-height',
    actualSize: 'actual-size',
    custom: 'custom',
  } as const,

  // 缩放灵敏度范围
  zoomSensitivity: {
    min: 10,
    max: 100,
    default: 50,
  },

  // 自动阅读间隔
  autoReadingInterval: {
    min: 1,
    max: 10,
    default: 3,
  },

  // 连续阅读设置
  continuousReading: {
    transitionDelay: 1000, // 1秒
  },
} as const

// =============================================================================
// 快捷键常量
// =============================================================================

export const SHORTCUTS = {
  nextPage: ['ArrowRight', 'KeyD', 'Space'],
  prevPage: ['ArrowLeft', 'KeyA'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  fitWidth: ['KeyF'],
  fullscreen: ['F11'],
  nextChapter: ['BracketRight'],
  prevChapter: ['BracketLeft'],
  escape: ['Escape'],
  home: ['Home'],
  end: ['End'],
} as const

// =============================================================================
// API 常量
// =============================================================================

export const API = {
  timeout: 10000, // 10秒
  retryCount: 3,
  retryDelay: 1000, // 1秒
} as const

// =============================================================================
// 错误代码常量
// =============================================================================

export const ERROR_CODES = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_FORMAT: 'INVALID_FORMAT',
  SCAN_FAILED: 'SCAN_FAILED',
  SAVE_FAILED: 'SAVE_FAILED',
  LOAD_FAILED: 'LOAD_FAILED',
} as const
