# 漫画阅读器开发计划 - 100% 原型图完美复现

## 📋 项目概述

**目标**: 基于 HTML 原型图 100% 完美复现漫画阅读器 Electron 应用
**当前状态**: Web 原型阶段（已完成）
**目标平台**: Linux 桌面版
**分支说明**: web 分支为原型图，main 分支为 Python 实现

---

## 🎯 核心目标

### 设计系统（100% 还原）
- ✅ **极简主义美学**: 干净界面，专注内容
- ✅ **iPhone 风格视觉**: 圆润边角、柔和阴影、精致细节
- ✅ **双主题支持**: 浅色主题 + 深色主题
- ✅ **6列响应式网格**: 漫画卡片布局
- ✅ **流畅动画**: 60fps 过渡效果

---

## 📅 分阶段开发计划

### 阶段 1: 架构搭建 (3-4天)
**目标**: 搭建 Electron + React + TypeScript 基础架构

#### 1.1 初始化项目
```bash
# 初始化 Electron 项目
npm init -y

# 核心依赖
npm install electron electron-builder
npm install react react-dom typescript
npm install vite @vitejs/plugin-react
npm install tailwindcss autoprefixer postcss
npm install @types/react @types/react-dom

# UI 组件库
npm install antd
# 或
npm install @mui/material @emotion/react @emotion/styled

# 状态管理
npm install zustand
```

#### 1.2 项目结构
```
comic-reader/
├── public/
│   ├── icons/
│   └── index.html
├── src/
│   ├── main/              # 主进程
│   ├── renderer/          # 渲染进程 (React)
│   ├── shared/            # 共享类型
│   └── workers/           # Web Workers
├── dist/                  # 构建输出
├── electron-builder.yml
├── package.json
└── tsconfig.json
```

#### 1.3 配置开发环境
- ✅ TypeScript 严格模式配置
- ✅ Vite 热更新开发配置
- ✅ Tailwind CSS 集成
- ✅ ESLint + Prettier 代码规范

---

### 阶段 2: 数据层设计 (2-3天)
**目标**: 实现 JSON 数据管理系统

#### 2.1 数据模型
```typescript
// src/shared/types/index.ts
interface Collection {
  id: string
  name: string
  author: string
  totalChapters: number
  coverPath: string
  tags: string[]
  rating: number
  lastUpdated: string
}

interface Chapter {
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

interface ComicData {
  collections: Collection[]
  chapters: Chapter[]
  readingProgress: ReadingProgress[]
  history: HistoryEntry[]
  favorites: FavoriteEntry[]
}
```

#### 2.2 DataManager 实现
```typescript
// src/renderer/services/database.ts
class DataManager {
  private data: ComicData
  private filePath: string

  // 加载数据
  loadData(): ComicData

  // 保存数据
  saveData(): Promise<void>

  // 保存阅读进度
  saveProgress(comicId: string, chapterIndex: number, page: number): Promise<void>

  // 获取阅读进度
  getProgress(comicId: string): ReadingProgress | null
}
```

#### 2.3 核心功能
- ✅ JSON 文件读写
- ✅ 数据序列化和反序列化
- ✅ 错误处理和默认值
- ✅ 原子性写入（防止数据损坏）

---

### 阶段 3: 主界面复现 (5-6天)
**目标**: 100% 还原原型图主界面

#### 3.1 布局系统
```typescript
// src/renderer/components/layout/
├── TopBar/          // 顶部标题栏
├── Sidebar/         // 左侧导航
├── ComicGrid/       // 漫画网格
└── ComicCard/       // 漫画卡片
```

#### 3.2 顶部标题栏 (100% 还原)
**原型图位置**: demo-minimal.html:58-76

```typescript
interface TopBar {
  logo: {
    icon: "fas fa-book-open"
    text: "漫画阅读器"
  }
  subtitle: "Discover Amazing Comics"
  actions: {
    settings: {
      icon: "fas fa-cog"
      text: "设置"
    }
    import: {
      icon: "fas fa-plus"
      text: "导入"
      type: "primary"
    }
  }
}
```

**设计规范**:
- 背景: `#FFFFFF` (白色)
- 边框: 底边框 `#E9ECEF` 1px
- 字体: `Inter, system-ui, sans-serif`
- 间距: `px-8 py-6` (32px / 24px)
- Logo 图标: `w-10 h-10 bg-minimal-blue rounded-lg`

#### 3.3 左侧导航栏 (100% 还原)
**原型图位置**: demo-minimal.html:80-115

```typescript
interface Sidebar {
  width: "w-64" // 256px
  background: "#F8F9FA"
  border: "border-r border-minimal-border"

  navigation: {
    title: "Navigation"
    items: [
      {
        key: "myComics",
        icon: "fas fa-th-large",
        text: "我的漫画",
        active: true,
        background: "bg-minimal-blue"
      },
      {
        key: "favorites",
        icon: "fas fa-heart",
        text: "收藏",
        count: 8,
        color: "text-minimal-red"
      },
      {
        key: "history",
        icon: "fas fa-clock",
        text: "历史",
        color: "text-minimal-blue"
      },
      {
        key: "categories",
        icon: "fas fa-folder",
        text: "分类",
        color: "text-minimal-green"
      },
      {
        key: "importRecords",
        icon: "fas fa-download",
        text: "导入记录",
        color: "text-minimal-muted"
      }
    ]
  }

  tags: {
    title: "Tags"
    items: ["冒险", "爱情", "奇幻", "科幻"]
  }
}
```

**设计规范**:
- 字体大小: `text-xs` (12px)
- 导航项: `px-4 py-3` (16px / 12px)
- 标签圆角: `rounded-full`
- 标签背景: `${color}/10` (10% 透明度)

#### 3.4 漫画网格 (100% 还原)
**原型图位置**: demo-minimal.html:137-345

```typescript
interface ComicGrid {
  columns: 6
  gap: "gap-5" // 20px
  card: {
    aspectRatio: "aspect-[3/4]"
    border: "border border-minimal-border"
    radius: "rounded-lg"
    hover: {
      borderColor: "hover:border-minimal-blue"
      transform: "hover:transform hover:-translate-y-2"
      transition: "transition all 0.2s ease"
    }
  }
  cardContent: {
    pageCount: {
      position: "absolute top-2 right-2"
      background: "bg-white/90"
      padding: "px-2 py-1"
      fontSize: "text-xs"
      color: "text-minimal-muted"
    }
    title: {
      fontSize: "text-sm"
      fontWeight: "font-medium"
      margin: "mb-1"
      color: "text-minimal-text"
      truncate: true
    }
    author: {
      fontSize: "text-xs"
      color: "text-minimal-muted"
      margin: "mb-2"
      fontWeight: "font-light"
    }
    rating: {
      icon: "fas fa-star"
      color: "text-minimal-yellow"
      size: "text-xs"
    }
    actions: {
      favorite: {
        icon: "far fa-heart"
        color: "text-minimal-red"
        active: "fas fa-heart"
      }
      play: {
        icon: "fas fa-play"
        color: "text-minimal-blue"
      }
    }
  }
}
```

**设计规范**:
- 列数: `grid-cols-6`
- 间距: `gap-5` (20px)
- 卡片宽高比: `3:4`
- 悬停效果: `translateY(-8px)`
- 过渡动画: `all 0.2s ease`

#### 3.5 搜索与筛选 (100% 还原)
**原型图位置**: demo-minimal.html:119-134

```typescript
interface SearchBar {
  input: {
    placeholder: "搜索漫画标题、作者..."
    padding: "px-4 py-3 pl-10"
    border: "border border-minimal-border"
    focus: "focus:input-focus" // border-color: #4A90E2
    icon: {
      position: "absolute left-3 top-1/2"
      transform: "transform -translate-y-1/2"
      icon: "fas fa-search"
    }
  }
  buttons: {
    filter: {
      icon: "fas fa-filter"
      text: "筛选"
    }
    grid: {
      icon: "fas fa-th-large"
      text: "网格"
    }
    list: {
      icon: "fas fa-list"
      text: "列表"
    }
  }
}
```

---

### 阶段 4: 阅读界面复现 (6-7天)
**目标**: 100% 还原阅读界面

#### 4.1 布局系统
```
src/renderer/components/ReadingInterface/
├── TopBar/              // 顶部工具栏
├── ReadingArea/         // 阅读区域
├── FloatingControls/    // 悬浮控制
└── BottomBar/          // 底部工具栏
```

#### 4.2 顶部工具栏 (100% 还原)
**原型图位置**: demo-minimal.html:355-370

```typescript
interface ReadingTopBar {
  background: "#FFFFFF"
  border: "border-b border-minimal-border"
  height: "py-4" // 16px 上下padding
  content: {
    left: {
      backButton: {
        icon: "fas fa-arrow-left"
        text: "返回"
        style: "px-4 py-2 text-minimal-muted hover:text-minimal-blue hover:bg-minimal-gray"
      }
      title: "进击的巨人 - 第1话"
    }
    right: {
      settings: {
        icon: "fas fa-cog"
        text: "设置"
      }
      fullscreen: {
        icon: "fas fa-expand"
        text: "全屏"
        type: "primary"
      }
    }
  }
}
```

#### 4.3 阅读区域 (100% 还原)
**原型图位置**: demo-minimal.html:373-394

```typescript
interface ReadingArea {
  minHeight: "min-h-[700px]"
  content: {
    image: {
      maxWidth: "max-w-4xl" // 896px
      aspectRatio: "aspect-[3/4]"
      background: "#F8F9FA"
      border: "border border-minimal-border"
      radius: "rounded-lg"
      placeholder: "fas fa-image text-7xl text-minimal-muted/20"
    }
  }
  floatingControls: {
    left: {
      position: "absolute left-6 top-1/2"
      transform: "transform -translate-y-1/2"
      button: {
        size: "w-12 h-12"
        background: "#FFFFFF"
        border: "border border-minimal-border"
        hover: "hover:border-minimal-blue"
        icon: "fas fa-chevron-left text-minimal-blue"
      }
    }
    right: {
      position: "absolute right-6 top-1/2"
      transform: "transform -translate-y-1/2"
      button: {
        size: "w-12 h-12"
        background: "#FFFFFF"
        border: "border border-minimal-border"
        hover: "hover:border-minimal-blue"
        icon: "fas fa-chevron-right text-minimal-blue"
      }
    }
  }
}
```

#### 4.4 底部工具栏 (100% 还原)
**原型图位置**: demo-minimal.html:397-431

```typescript
interface BottomBar {
  background: "#FFFFFF"
  border: "border-t border-minimal-border"
  padding: "px-8 py-4"
  content: {
    left: {
      prevButton: {
        icon: "fas fa-chevron-left"
      }
      pageInfo: "第 1 页 / 共 120 页"
      nextButton: {
        icon: "fas fa-chevron-right"
      }
    }
    center: {
      zoomOut: {
        icon: "fas fa-search-minus"
        text: "缩小"
      }
      fitWidth: {
        icon: "fas fa-expand-arrows-alt"
        text: "适应宽度"
        active: true
        background: "bg-minimal-blue text-white"
      }
      zoomIn: {
        icon: "fas fa-search-plus"
        text: "放大"
      }
    }
    right: {
      chapterButton: {
        icon: "fas fa-list"
        text: "章节"
      }
      progressBar: {
        width: "w-32" // 128px
        height: "h-1.5" // 6px
        background: "#F8F9FA"
        radius: "rounded-full"
        fill: {
          background: "bg-minimal-blue"
          radius: "rounded-full"
          width: "8%" // 可变
        }
      }
      progressText: "8%"
    }
  }
}
```

**设计规范**:
- 分组布局: `flex items-center justify-between`
- 按钮大小: `px-4 py-2`
- 进度条: `rounded-full h-1.5`
- 进度填充: `bg-minimal-blue h-1.5 rounded-full`

---

### 阶段 5: 搜索与筛选界面复现 (4-5天)
**目标**: 100% 还原搜索筛选界面

#### 5.1 布局系统
```
src/renderer/components/SearchInterface/
├── FilterPanel/       // 左侧筛选
└── ResultArea/       // 右侧结果
```

#### 5.2 左侧筛选面板 (100% 还原)
**原型图位置**: demo-minimal.html:446-549

```typescript
interface FilterPanel {
  width: "w-72" // 288px
  background: "#F8F9FA"
  border: "border-r border-minimal-border"
  padding: "p-6"

  title: {
    text: "筛选条件"
    icon: "fas fa-filter"
    size: "text-sm font-medium"
  }

  sections: {
    readingStatus: {
      title: "阅读状态"
      items: [
        { text: "全部", checked: true },
        { text: "未开始", checked: false },
        { text: "阅读中", checked: false },
        { text: "已完结", checked: false }
      ]
    }
    rating: {
      title: "评分"
      items: [
        { text: "全部", selected: true },
        { text: "9分以上", selected: false },
        { text: "8分以上", selected: false },
        { text: "7分以上", selected: false }
      ]
    }
    tags: {
      title: "标签"
      items: ["冒险", "爱情", "奇幻", "科幻", "校园", "职场"]
    }
    pageRange: {
      title: "页数范围"
      inputs: {
        min: "number placeholder:最小"
        max: "number placeholder:最大"
        slider: "range min:0 max:500"
      }
    }
  }

  actionButtons: {
    apply: {
      text: "应用筛选"
      type: "primary"
      icon: "fas fa-check"
    }
    reset: {
      text: "重置"
      type: "default"
      icon: "fas fa-undo"
    }
  }
}
```

**设计规范**:
- 标题: `text-xs font-medium text-minimal-muted uppercase tracking-wider`
- 标签选择: `px-3 py-1.5 bg-white border border-minimal-border rounded-full`
- 输入框: `w-full px-3 py-2 border border-minimal-border rounded-md`
- 滑块: `w-full accent-minimal-blue` (CSS)

#### 5.3 右侧结果区域 (100% 还原)
**原型图位置**: demo-minimal.html:552-694

```typescript
interface ResultArea {
  padding: "p-8"
  header: {
    searchInput: {
      placeholder: "搜索漫画标题、作者..."
      padding: "px-5 py-3 pl-12"
      icon: {
        position: "absolute left-4 top-1/2"
        transform: "transform -translate-y-1/2"
        icon: "fas fa-search"
      }
    }
    searchButton: {
      text: "搜索"
      padding: "px-6 py-3"
      type: "primary"
    }
  }

  sortBar: {
    resultCount: {
      total: 156
      color: "text-minimal-blue font-medium"
    }
    sortDropdown: {
      label: "排序方式："
      options: ["相关性", "最新更新", "评分最高", "页数最多"]
    }
  }

  results: {
    grid: "grid grid-cols-6 gap-5"
    card: {
      // 同主界面漫画卡片
      extra: {
        matchScore: {
          position: "absolute top-2 right-2"
          background: "bg-white/90"
          padding: "px-2 py-1"
          fontSize: "text-xs"
          text: "匹配度: 95%"
        }
      }
    }
  }

  pagination: {
    currentPage: 1
    totalPages: 15
    showPages: [1, 2, 3, "...", 15]
    buttons: {
      prev: "fas fa-chevron-left"
      next: "fas fa-chevron-right"
    }
  }
}
```

**设计规范**:
- 网格: `grid grid-cols-6 gap-5`
- 匹配度标签: 右上角白色半透明背景
- 分页: `px-4 py-2 border border-minimal-border`
- 当前页: `bg-minimal-blue text-white`

---

### 阶段 6: 设置界面复现 (3-4天)
**目标**: 100% 还原设置界面

#### 6.1 布局系统
```
src/renderer/components/SettingsInterface/
├── SettingsNav/       // 左侧设置导航
└── SettingsContent/   // 右侧设置内容
```

#### 6.2 左侧设置导航 (100% 还原)
**原型图位置**: demo-minimal.html:708-736

```typescript
interface SettingsNav {
  width: "w-64" // 256px
  background: "#F8F9FA"
  border: "border-r border-minimal-border"
  padding: "p-6"

  title: {
    text: "Settings"
    size: "text-xs font-medium text-minimal-muted uppercase tracking-wider"
    margin: "mb-3"
  }

  items: [
    {
      key: "reading",
      icon: "fas fa-book",
      text: "阅读设置",
      active: true,
      background: "bg-minimal-blue"
    },
    {
      key: "display",
      icon: "fas fa-desktop",
      text: "显示设置",
      active: false
    },
    {
      key: "shortcuts",
      icon: "fas fa-keyboard",
      text: "快捷键",
      active: false
    },
    {
      key: "storage",
      icon: "fas fa-hdd",
      text: "存储设置",
      active: false
    },
    {
      key: "notification",
      icon: "fas fa-bell",
      text: "通知设置",
      active: false
    },
    {
      key: "about",
      icon: "fas fa-info-circle",
      text: "关于",
      active: false
    }
  ]
}
```

**设计规范**:
- 按钮: `w-full text-left px-4 py-3`
- 激活状态: `bg-minimal-blue text-white`
- 非激活: `hover:bg-white`
- 图标颜色: 对应语义颜色

#### 6.3 右侧设置内容 (100% 还原)
**原型图位置**: demo-minimal.html:739-881

```typescript
interface SettingsContent {
  padding: "p-8"
  section: {
    background: "#F8F9FA"
    radius: "rounded-lg"
    padding: "p-6"
    margin: "mb-6"
    title: {
      icon: "fas fa-book"
      text: "阅读设置"
      size: "text-lg font-light"
      margin: "mb-6"
    }
  }

  subsections: {
    pageDirection: {
      title: "翻页设置"
      icon: "fas fa-exchange-alt"
      options: [
        {
          value: "rtl",
          text: "从右到左",
          description: "点击右侧翻到下一页",
          checked: true
        },
        {
          value: "ltr",
          text: "从左到右",
          description: "点击左侧翻到下一页",
          checked: false
        }
      ]
    }
    zoom: {
      title: "缩放设置"
      icon: "fas fa-search"
      mode: {
        label: "默认缩放模式"
        options: ["适应宽度", "适应高度", "实际大小", "自定义比例"]
      }
      sensitivity: {
        label: "缩放灵敏度"
        slider: "range min:10 max:100 value:50"
        labels: ["低", "中", "高"]
      }
    }
    shortcuts: {
      title: "快捷键设置"
      icon: "fas fa-keyboard"
      items: [
        { text: "上一页", keys: ["←", "A"] },
        { text: "下一页", keys: ["→", "D"] },
        { text: "放大", keys: ["+"] },
        { text: "缩小", keys: ["-"] },
        { text: "适应宽度", keys: ["F"] },
        { text: "全屏", keys: ["F11"] }
      ]
    }
    autoReading: {
      title: "自动阅读"
      icon: "fas fa-play-circle"
      enabled: {
        label: "启用自动阅读"
        checked: false
      }
      interval: {
        label: "翻页间隔（秒）"
        value: 3
        min: 1
        max: 10
      }
    }
  }

  actionButtons: {
    save: {
      text: "保存设置"
      type: "primary"
      icon: "fas fa-save"
    }
    reset: {
      text: "恢复默认"
      type: "default"
      icon: "fas fa-undo"
    }
  }
}
```

**设计规范**:
- 设置块: `bg-minimal-gray rounded-lg p-6`
- 标签: `text-xs font-medium text-minimal-muted uppercase tracking-wider`
- 单选框组: `flex space-x-3`
- 快捷键标签: `px-2 py-1 bg-minimal-gray text-minimal-blue`
- 滑块: `w-full accent-minimal-blue`

---

### 阶段 7: 文件扫描与合集识别 (4-5天)
**目标**: 实现自动扫描和智能合集识别

#### 7.1 文件扫描器
```typescript
// src/renderer/services/file-scanner.ts
class FileScanner {
  // 扫描漫画文件夹
  async scanDirectory(rootPath: string): Promise<Comic[]>

  // 识别合集
  detectCollections(directories: Directory[]): Collection[]

  // 生成缩略图
  generateThumbnails(comic: Comic): Promise<void>
}
```

#### 7.2 合集识别算法
```typescript
class CollectionDetector {
  // 支持的命名模式
  private patterns = [
    /第(\d+)话/,
    /第(\d+)集/,
    /Vol\.(\d+)/,
    /第(\d+)卷/,
    /Chapter\s+(\d+)/i
  ]

  // 提取基础名称
  extractBaseName(dirName: string): string

  // 提取章节号
  getChapterNumber(dirName: string): number

  // 智能分组
  groupIntoCollections(dirs: Directory[]): Collection[]
}
```

**支持的目录结构**:
```
📁 漫画/
├── 📁 进击的巨人/
│   ├── 📁 第1话/
│   ├── 📁 第2话/
│   └── 📁 第3话/
├── 📁 鬼灭之刃/
│   ├── 📁 Vol.1/
│   ├── 📁 Vol.2/
│   └── 📁 Vol.3/
└── 📁 火影忍者/
    ├── 📁 火影忍者_第1话/
    └── 📁 火影忍者_第2话/
```

---

### 阶段 8: 阅读功能实现 (5-6天)
**目标**: 实现完整阅读功能

#### 8.1 图片加载与显示
```typescript
class ImageLoader {
  // 预加载
  preloadImages(urls: string[]): Promise<void>

  // 懒加载
  lazyLoad(): IntersectionObserver

  // 缓存
  private cache: Map<string, Image>
}
```

#### 8.2 翻页控制
```typescript
class PageNavigator {
  // 上一页
  prevPage(): void

  // 下一页
  nextPage(): void

  // 跳转到指定页
  goToPage(pageIndex: number): void

  // 连续阅读
  autoNextChapter(): void
}
```

#### 8.3 缩放控制
```typescript
class ZoomController {
  modes = ["fit-width", "fit-height", "actual-size", "custom"] as const

  // 设置缩放模式
  setMode(mode: ZoomMode): void

  // 自定义缩放
  setScale(scale: number): void

  // 适应窗口
  fitToWindow(): void
}
```

#### 8.4 全屏模式
```typescript
class FullscreenManager {
  // 进入全屏
  enter(): void

  // 退出全屏
  exit(): void

  // 切换全屏
  toggle(): void

  // 监听全屏变化
  onChange(callback: () => void): void
}
```

---

### 阶段 9: 连续阅读与进度跟踪 (3-4天)
**目标**: 实现智能进度管理

#### 9.1 进度保存
```typescript
class ProgressManager {
  // 保存阅读进度
  async saveProgress(
    collectionId: string,
    chapterIndex: number,
    currentPage: number
  ): Promise<void>

  // 获取阅读进度
  getProgress(collectionId: string): Progress | null

  // 智能恢复
  async getResumePoint(collectionId: string): Promise<ResumePoint>
}
```

#### 9.2 连续阅读
```typescript
class ContinuousReading {
  // 自动跳转下一集
  autoNextChapter(): void

  // 跳转提示
  showTransitionMessage(): void

  // 配置
  config = {
    enabled: true,
    delay: 1000, // ms
    showMessage: true
  }
}
```

---

### 阶段 10: 性能优化与测试 (3-4天)
**目标**: 优化性能，完善测试

#### 10.1 性能优化
- ✅ **虚拟滚动**: 大列表性能优化
- ✅ **懒加载**: 图片按需加载
- ✅ **缩略图缓存**: 提升加载速度
- ✅ **内存管理**: 防止内存泄漏

#### 10.2 测试覆盖
```bash
# 单元测试
npm run test:unit

# 集成测试
npm run test:integration

# E2E 测试
npm run test:e2e

# 覆盖率报告
npm run test:coverage
```

#### 10.3 性能指标
| 指标 | 目标值 | 说明 |
|------|--------|------|
| 启动时间 | < 2 秒 | 冷启动 |
| 内存占用 | < 150MB | 浏览 100 个漫画 |
| 扫描速度 | 1000 漫画/秒 | 并发 8 线程 |
| 缩放图生成 | < 100ms/张 | 200x300 像素 |
| 图片加载 | < 50ms | 本地 SSD |

---

## 🎯 关键里程碑

### 里程碑 1: 基础架构完成
**时间**: 第 1-2 周末
**交付物**:
- ✅ Electron + React + TypeScript 项目结构
- ✅ JSON 数据管理系统
- ✅ Tailwind CSS 样式系统
- ✅ 开发环境配置完成

### 里程碑 2: 主界面完成
**时间**: 第 3-4 周末
**交付物**:
- ✅ 100% 还原主界面原型图
- ✅ 漫画网格展示
- ✅ 搜索与筛选
- ✅ 基础导航功能

### 里程碑 3: 阅读界面完成
**时间**: 第 5-6 周末
**交付物**:
- ✅ 100% 还原阅读界面原型图
- ✅ 翻页、缩放、全屏功能
- ✅ 悬浮控制按钮
- ✅ 进度条显示

### 里程碑 4: 搜索界面完成
**时间**: 第 7 周末
**交付物**:
- ✅ 100% 还原搜索筛选界面
- ✅ 多维度筛选
- ✅ 排序与分页
- ✅ 匹配度计算

### 里程碑 5: 设置界面完成
**时间**: 第 8 周末
**交付物**:
- ✅ 100% 还原设置界面原型图
- ✅ 阅读设置配置
- ✅ 快捷键设置
- ✅ 自动阅读配置

### 里程碑 6: 核心功能完成
**时间**: 第 9-10 周末
**交付物**:
- ✅ 文件扫描与合集识别
- ✅ 连续阅读与进度跟踪
- ✅ 性能优化
- ✅ 完整测试覆盖

### 里程碑 7: 发布准备
**时间**: 第 11 周末
**交付物**:
- ✅ 构建生产版本
- ✅ Linux 安装包
- ✅ 用户文档
- ✅ 性能验证

---

## 🚀 快速开始开发

### 环境要求
```bash
Node.js: 20.0+
Python: 3.8+ (用于编译原生模块)
Linux: Ubuntu 20.04+ / CentOS 8+ / Arch Linux
Git: 最新版本
```

### 初始化项目
```bash
# 1. 克隆项目
git clone <repo-url>
cd comic-reader

# 2. 切换到 web 分支
git checkout web

# 3. 安装依赖
npm install

# 4. 预编译原生模块
npm run rebuild

# 5. 启动开发服务器
npm run dev
```

### 开发命令
```bash
# 启动开发模式 (推荐)
npm run dev

# 启动渲染进程 (Vite 热更新)
npm run dev:renderer

# 启动主进程 (Electron)
npm run dev:main

# 构建生产版本
npm run build

# 打包可执行文件
npm run pack

# 生成安装包
npm run dist
```

---

## 📐 设计系统参考

### 颜色系统
```css
:root {
  --minimal-gray: #F8F9FA;     /* 主背景 */
  --minimal-border: #E9ECEF;   /* 边框 */
  --minimal-text: #2C3E50;     /* 文本 */
  --minimal-muted: #6C757D;    /* 次要文本 */
  --minimal-blue: #4A90E2;     /* 主色 */
  --minimal-green: #50C878;    /* 成功 */
  --minimal-red: #E74C3C;      /* 错误 */
  --minimal-yellow: #F39C12;   /* 警告 */
}
```

### 字体系统
```css
font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont,
             'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
             'Microsoft YaHei', sans-serif;
```

### 间距系统 (Tailwind)
- xs: `4px` (0.25rem)
- sm: `8px` (0.5rem)
- md: `12px` (0.75rem)
- lg: `16px` (1rem)
- xl: `20px` (1.25rem)
- 2xl: `24px` (1.5rem)
- 3xl: `32px` (2rem)
- 4xl: `40px` (2.5rem)
- 5xl: `48px` (3rem)

### 圆角系统
- sm: `4px` (0.25rem) - 小元素
- md: `6px` (0.375rem) - 按钮
- lg: `8px` (0.5rem) - 卡片
- xl: `12px` (0.75rem) - 大卡片
- full: `9999px` - 圆形

---

## 🔧 技术选型

### 前端技术
- **框架**: Electron 28+ (Chrome 120 + Node.js 20)
- **UI**: React 18 + TypeScript 5
- **构建**: Vite 5 (快速热更新)
- **样式**: Tailwind CSS 3
- **组件库**: Ant Design / Material-UI
- **状态**: Zustand (轻量级)
- **路由**: React Router 6
- **图标**: Font Awesome 6

### 开发工具
- **代码规范**: ESLint + Prettier
- **类型检查**: TypeScript strict mode
- **测试**: Jest + Testing Library
- **打包**: electron-builder
- **更新**: electron-updater

---

## 📝 开发规范

### 代码规范
- **TypeScript**: 严格模式，所有文件必须类型化
- **ESLint**: 使用 @typescript-eslint/recommended
- **Prettier**: 自动格式化
- **Git Hooks**: pre-commit 自动检查

### 命名规范
- **组件**: PascalCase (e.g., `ComicCard.tsx`)
- **文件**: kebab-case (e.g., `file-scanner.ts`)
- **常量**: UPPER_SNAKE_CASE (e.g., `MAX_CACHE_SIZE`)
- **接口**: PascalCase 前缀 I (e.g., `IComicData`)

### 提交规范 (Conventional Commits)
```bash
# 功能新增
git commit -m "feat: 添加漫画卡片组件"

# 修复bug
git commit -m "fix: 修复缩放功能异常"

# 文档更新
git commit -m "docs: 更新阅读界面文档"

# 样式调整
git commit -m "style: 调整主界面布局"

# 重构代码
git commit -m "refactor: 重构数据管理逻辑"

# 性能优化
git commit -m "perf: 优化图片懒加载"

# 测试相关
git commit -m "test: 添加阅读界面测试用例"

# 构建相关
git commit -m "build: 更新构建配置"
```

---

## 🐛 常见问题

### Q: 原型图细节不准确？
**A**: 参考 HTML 原型文件 `html/demo-minimal.html`，所有元素的位置、颜色、大小都已在原型中标明。

### Q: 如何处理中文路径？
**A**: Node.js 原生支持 UTF-8，无需额外处理。确保系统 locale 设置为 `zh_CN.UTF-8`。

### Q: 合集识别失败？
**A**: 检查文件夹命名是否符合标准模式（见阶段 7），支持：第N话、第N集、Vol.N、第N卷。

### Q: 性能优化建议？
**A**:
1. 虚拟滚动处理大列表
2. 懒加载图片
3. 缩略图缓存
4. 内存监控与垃圾回收

---

## 📚 参考资源

- **HTML 原型**: `html/demo-minimal.html` (100% 还原参考)
- **暗色主题**: `html/demo-dark.html`
- **基础原型**: `html/demo.html`
- **项目文档**: `README.md`
- **设计规范**: 见本文件「设计系统参考」章节

---

## 🎉 总结

本开发计划基于 **HTML 原型图 100% 完美复现** 的目标制定，共分为 **10 个阶段**，预计开发周期 **11 周**。

**核心理念**:
1. **像素级精确**: 100% 还原原型图每一个细节
2. **性能优先**: 优化加载速度和内存占用
3. **用户体验**: 流畅动画和直观交互
4. **代码质量**: 严格类型检查和全面测试

**关键成功因素**:
- ✅ 仔细研读 HTML 原型文件
- ✅ 遵循设计系统规范
- ✅ 分阶段验收，确保质量
- ✅ 持续性能监控和优化

---

**让阅读成为一种享受 ✨**

> 记住：这个项目是为 Linux 桌面用户打造的现代化漫画阅读器，目标是提供最优秀的阅读体验。每一个像素、每一个动画都至关重要！
