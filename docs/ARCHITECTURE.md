# ARCHITECTURE · 系统设计

> 面向工程师的架构说明。讲清楚组件怎么连、数据怎么流、瓶颈在哪、为什么这样选。

---

## 0. 一图流

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React SPA · Vite + React 18 + TS + Tailwind)      │
│                                                             │
│  Routes ── zustand store ── API client (fetch + SSE)        │
│    │           │                    │                       │
│    ├── layout: AppShell / Sidebar / Toolbar / StatusBar     │
│    ├── home:   YearTimeline / AlbumGrid / AlbumCard         │
│    ├── viewer: ImageViewer / VideoPlayer / PageSlider       │
│    └── common: HelpOverlay / HoverPreview / ThemeSwitcher   │
│                                                             │
│  IntersectionObserver lazy-load · react-virtuoso 虚拟滚动   │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTP (JSON / Range)  ·  SSE (text/event-stream)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend (Go 1.24 + Fiber v2)                               │
│                                                             │
│  Middleware:  logger · recover · path_safety                │
│  Handlers:    /api/scan · /api/folders · /api/thumbs        │
│               /api/videos · /api/images · /api/config       │
│               /api/prefs · /api/favorites · /api/history    │
│               /api/progress · /api/videos/transcode/*       │
│                                                             │
│  Services:                                                  │
│    scanner ── smart_group ── scan_runner                    │
│    thumbnail (LRU + disk) ── video_cover (ffmpeg)           │
│    video_info (ffprobe) ── video_faststart (remux)          │
│    video_transcode (H.264+AAC)                              │
│    image_info · cache_stats                                 │
│  Store:     prefs.json (atomic tmp+rename)                  │
│  Config:    config.yaml + Manager (hot reload)              │
└────────────────┬────────────────────────────────────────────┘
                 │ file I/O · os/exec ffmpeg/ffprobe
                 ▼
        ┌────────────────────────────┐
        │ 文件系统（一个或多个根）    │
        │  E:\图像  F:\漫画  ~/pic   │
        │  ── 媒体文件 + 缓存目录    │
        └────────────────────────────┘
```

---

## 1. 核心抽象

应用对**目录与媒体类型保持中性**。`漫画 / 同人志 / 照片 / 视频` 都被同一套模型描述。

### 1.1 领域模型

```go
// Album — 一个非空子目录
type Album struct {
    Path        string   // 绝对路径
    Name        string   // 目录名
    ImageFiles  []string
    VideoFiles  []string
    ImageCount  int
    VideoCount  int
    CoverKind   string   // "image" | "video"
    CoverImage  string   // 文件路径
    Tags        []string // 从 [xxx] 段提取
    Author      string   // 兼容字段，等于 Tags[0]
    // ... mtime / size / sourceRoot
}

// Collection — 上层目录（深度可达 MaxDepth）
type Collection struct {
    Path       string
    Name       string
    Albums     []Album
    AlbumCount int
}

// SmartCollection — 按标签聚合
type SmartCollection struct {
    Tag        string
    Author     string
    Albums     []Album
    AlbumCount int
    CoverImage string
}
```

**关键设计**：
- `Album` 序列化时同时输出 `imageFiles` 和 `files`（双键别名，向后兼容）
- `CoverKind` 标识封面源（`"image"` / `"video"`）— 列表渲染时知道该不该走 `VideoCoverImage`
- `Author` 字段已弃用但保留为 `Tags[0]` 的别名，旧客户端不会炸
- 一个 `Album` 可属于多个 `SmartCollection`（多标签）

### 1.2 标签提取

```go
// smart_group.go
func ExtractTags(dirName string) []string {
    // "[作者A][分类B] 卷01" → ["作者A", "分类B"]
    // "无标签卷01"        → []
    re := regexp.MustCompile(`\[([^\]]+)\]`)
    return re.FindAllStringSubmatch(dirName, -1)...
}
```

提取规则可重写，但保持现状已经够用：括号里的就是标签。

---

## 2. 后端模块

```
backend/
├── cmd/server/main.go              # 入口：flag + YAML + 服务装配
├── internal/
│   ├── config/                     # YAML 加载 + 校验 + 热更新
│   │   ├── config.go               # Config struct + LoadFile + Validate
│   │   ├── manager.go              # Manager（热更新 / 原子写）
│   │   └── patch.go                # PATCH 合并（bool 字段语义）
│   ├── models/                     # 领域模型
│   │   └── *.go                    # Album / Collection / SmartCollection / Prefs
│   ├── services/                   # 业务
│   │   ├── scanner.go              # 目录遍历 + worker pool
│   │   ├── smart_group.go          # 标签提取 / 智能合集聚合
│   │   ├── scan_runner.go          # 异步扫描 + SSE 推送 + 取消
│   │   ├── scan_cache.go           # 最近一次扫描结果缓存
│   │   ├── thumbnail.go            # LRU + 磁盘 + 视频封面 save
│   │   ├── video_cover.go          # ffmpeg 抽帧（-ss before -i）
│   │   ├── video_info.go           # ffprobe 元数据
│   │   ├── video_faststart.go      # remux moov 到 mdat 前面
│   │   ├── video_transcode.go      # H.264+AAC 转码
│   │   ├── image_info.go           # 尺寸 / 格式 / checksum
│   │   └── cache_stats.go          # 缩略图命中率
│   ├── store/
│   │   └── prefs.go                # JSON 原子写
│   ├── handlers/                   # Fiber 路由
│   │   ├── albums.go / scan.go     # 扫描 / 文件夹 / 智能合集 / 搜索
│   │   ├── thumbs.go / cache.go    # 缩略图 + 清理 + 统计
│   │   ├── images.go               # 原图（Range / ETag / HEIC）
│   │   ├── videos.go               # 视频流（Range / ETag / 转码决策）
│   │   ├── transcode.go            # 转码 status / events / cancel / cache
│   │   ├── config.go               # GET/PUT /api/config
│   │   ├── prefs.go                # GET/PATCH /api/prefs + favorites / history / progress
│   │   ├── fs.go                   # /api/fs/open
│   │   └── health.go               # /api/health
│   └── middleware/
│       ├── path_safety.go          # 绝对路径 / 多根 / smart: 前缀
│       ├── logger.go               # 结构化访问日志
│       └── recover.go              # panic recover
└── tests/integration/              # app.Test 端到端 HTTP 测试
```

### 2.1 配置（`internal/config`）

- **唯一来源**：`backend/config.yaml`，相对 CWD；不存在则用 `Default()`
- **字段优先级**：YAML 显式值 > 内置默认；无 env / CLI 覆盖
- **热更新**：`Manager` 持有当前快照，`PUT /api/config` 写回 YAML（atomic tmp+rename）后通过 channel 推送给已注册的 service
- **bool 字段语义**：YAML 未设视为 `false`；PATCH 不传视为 unset；存盘时只持久化显式给过的字段
- **需重启字段**：`host` / `port` / `staticDir`（监听和静态托管在启动期绑定）

### 2.2 扫描（`internal/services/scanner` + `scan_runner`）

```
POST /api/scan/start
  → scan_runner.Start(opts)
    → uuid.New() → scanId
    → goroutine: scanner.ScanWithHook(opts, hook)
      → filepath.WalkDir
      → worker pool (min(8, NumCPU))
        → 每个非空子目录 = 一个 Album
        → 推 ProgressEvent (running, partial)
      → smart_group.GroupByTag(albums)
      → 推 ProgressEvent (complete)
  ← { scanId }
```

进度推送走 `chan ProgressEvent`，handler 把 channel 灌进 `SetBodyStreamWriter` 写 SSE：

```go
c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
    for ev := range state.Events {
        fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, ev.Data)
        w.Flush()  // 每事件 flush，不缓冲
    }
})
```

取消：`DELETE /api/scan/:id` → `state.Cancel` → `ctx.Done()` 传到 scanner goroutine → 干净退出。

### 2.3 缩略图（`internal/services/thumbnail`）

```go
type ThumbnailService struct {
    memCache *lru.Cache[string, []byte]   // 500 项 LRU
    onDisk   string                       // <cacheDir>/thumbs/
    videoCover VideoCoverExtractor        // 视频封面抽帧
}

func (s *ThumbnailService) GetOrCreate(path string) ([]byte, error) {
    if data, ok := s.memCache.Get(path); ok { return data, nil }
    if data, err := s.readDisk(path); err == nil {
        s.memCache.Add(path, data)
        return data, nil
    }
    data, err := s.generate(path)  // imaging.Fit
    if err == nil {
        s.memCache.Add(path, data)
        s.writeDisk(path, data)
    }
    return data, err
}
```

失效：磁盘文件以 `<md5>.jpg` 命名，不带源 mtime 信息。**mtime 检测在外层 handler**：

```go
if imgStat, _ := os.Stat(path); thumbStat, _ := os.Stat(thumbPath); thumbStat.ModTime().Before(imgStat.ModTime()) {
    os.Remove(thumbPath)  // 过期了，重生成
}
```

### 2.4 视频管线（核心）

视频是本项目最硬核的部分。一次 `/api/videos?path=...` 请求经过 4 层 fallback：

```
请求 → TranscodeService → FaststartService → 原文件
        (冷门编码→H.264)  (moov 在末尾)    (兜底)
```

每一层都是**纯函数 + 缓存**：
- 命中缓存 → 立即返回
- 需要做 → 后台异步 → 返回当前最佳字节
- 失败 → 静默回退到下一层

```
                          ┌────────────────────┐
GET /api/videos?path=...  │  VideoHandler      │
                          └──────────┬─────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  ▼                  ▼                  ▼
          ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
          │  Transcode   │   │  Faststart   │   │  原文件      │
          │  Service     │   │  Service     │   │  (兜底)      │
          └──────┬───────┘   └──────┬───────┘   └──────────────┘
                 │                  │
        缓存命中 │ 不命中          │ 缓存命中
        ↓        │ 启动 ffmpeg     ↓
        return   │ 异步转码        return
                 ▼
        返回原文件 + SSE 推进度
        转码完成后下次命中
```

**判定时机**（首次访问某视频）：

1. `TranscodeService.Resolve(path)`
   - 缓存命中 → 返回缓存文件
   - ffprobe 探 codec → 浏览器支持 → 跳过转码，记 `not_needed`
   - 浏览器不支持 → 启动后台转码，记 `running` → 返回原文件 + 推送 SSE 进度
2. `FaststartService.Resolve(path)`
   - moov 在前 → 跳过
   - moov 在后 → remux 写到缓存，返回 remux 文件
3. 原文件兜底

**为什么不直接等待转码？** 4K HEVC 转码可能 10-20 分钟，等不起。**先让用户看原文件（多半也能播），后台慢慢转，下一次访问就是转好的**。

#### 2.4.1 codec 兼容性判定

| 视频 codec | 容器 | 浏览器 | 处理 |
|-----------|------|--------|------|
| h264 | mp4 / m4v / mov | ✅ | 跳过 |
| h264 | mkv | ✅ (Chrome/Edge) | 跳过 |
| h264 | avi | ⚠️ | 转码（保守） |
| vp9 / vp8 | webm | ✅ | 跳过 |
| av1 | webm | ✅ | 跳过 |
| av1 | mp4 / m4v | ⚠️ | 转码 |
| hevc / h265 | 任意 | ❌ | 转码 |
| prores | mov | ❌ | 转码 |
| 其他 | 任意 | ❌ | 转码 |

V1 只在「明确不支持」时才转码；「部分支持」（vp9 in Safari 等）留 V2 引入 UA 探测。

#### 2.4.2 转码目标

固定单一 profile，避免无限参数组合撑爆缓存：

```
容器:    mp4 (faststart)
视频:    H.264 High@L4.1
音频:    AAC LC, 128kbps
CRF:     22 (视觉无损/中等大小，可配)
```

#### 2.4.3 并发与取消

```go
type TranscodeService struct {
    flight  singleflight.Group         // 同 key 同一时刻只跑一个 ffmpeg
    sem     chan struct{}              // 全局并发限流
    inflight map[string]context.CancelFunc  // 取消表
}
```

- **singleflight**：10 个用户同时打开同一个 4K AV1，只转一次
- **sem**：容量 = `max(1, NumCPU/2)`，避免 ffmpeg 把机器吃满
- **取消**：用户切走 / 调 `POST /api/videos/transcode/cancel` → `cancel()` → ffmpeg SIGTERM
- **超时**：单视频 30 分钟（4K 60min 视频 10-20 分钟够用）

#### 2.4.4 缓存策略

```
<cacheDir>/
├── thumbs/<md5>.jpg                    # 缩略图
├── video-faststart/<md5>.mp4           # remux 结果
└── video-transcode/<md5>.mp4           # 转码结果
```

```go
func transcodeKey(absPath string, fi os.FileInfo, profile string) string {
    h := md5.New()
    fmt.Fprintf(h, "tx:%s|%d|%d|%s", absPath, fi.ModTime().UnixNano(), fi.Size(), profile)
    return hex.EncodeToString(h.Sum(nil))
}
```

源文件 mtime / size 变 → 自动失效（用户重下载 / 重编码后）。profile 变 → 自动失效。

#### 2.4.5 失败模式

| 场景 | 行为 | 用户感知 |
|------|------|---------|
| ffmpeg 不可用 | `Resolve()` 返回原文件 + `StatusUnavailable` | 跟今天一样 |
| ffmpeg 启动后挂 | 记 `failed`，下次直接发原文件 | 原文件播不了就播不了 |
| 磁盘满 | `os.WriteFile` 失败 → 取消 + 标记 failed | 同上 |
| 源文件被删 | Stat 失败 → 404 | 同上 |
| 缓存文件 0 字节 | 启动时校验 size > 0，删除重转 | 多等一会儿 |
| 多个用户同时请求 | singleflight 合一，其他订阅 SSE | 体验顺滑 |
| 转一半用户走了 | ffmpeg SIGTERM；下次重转 | 浪费一点 CPU |
| mtime 变化 | key 失效，自动重转 | 0 介入 |

**所有失败都写 server log**，用户能在 UI 上看到简短原因，详细在 `transcode failed for <path>: <err>`。

### 2.5 路径安全（`internal/middleware/path_safety`）

所有 `?path=` 请求都过这个中间件：

```go
func SafePath(c *fiber.Ctx) string {
    path := c.Query("path")
    if path == "" { return "" }
    if strings.HasPrefix(path, "smart:") { return path }  // 智能合集查询放行
    if !filepath.IsAbs(path) { return "" }
    for _, root := range roots {
        rel, err := filepath.Rel(root, path)
        if err != nil { continue }
        if !strings.HasPrefix(rel, "..") {
            return path  // 落在某个 root 下
        }
    }
    return ""  // 越权
}
```

校验失败 → 400。`smart:<tag>` 单独放行不做绝对路径校验。

### 2.6 偏好持久化

```go
func (s *Store) Save(p Prefs) error {
    tmp := s.path + ".tmp"
    data, _ := json.MarshalIndent(p, "", "  ")
    if err := os.WriteFile(tmp, data, 0644); err != nil { return err }
    return os.Rename(tmp, s.path)  // 原子替换
}
```

tmp + rename 是 POSIX 原子操作。崩溃后最多丢最后一次写入。

---

## 3. 前端模块

```
frontend/src/
├── api/                                # fetch + SSE 封装
│   ├── client.ts                       # api<T>() / sse() / ApiError
│   ├── scan.ts                         # /api/scan/*
│   ├── thumbs.ts                       # thumbUrl(path)
│   ├── videos.ts                       # videoSrc(path)
│   ├── prefs.ts                        # /api/prefs / favorites / history
│   ├── images.ts                       # imageInfo / 原图
│   ├── fs.ts                           # /api/fs/open
│   └── transcode.ts                    # /api/videos/transcode/*
├── hooks/                              # 复用 hooks
│   ├── useKeyboard.ts                  # 全局快捷键（输入框聚焦自动失效）
│   ├── useScanSSE.ts                   # 扫描 SSE 订阅
│   ├── useTheme.ts                     # data-theme attribute
│   ├── useReadingProgress.ts           # 1.5s debounce 上报
│   ├── useFavorites.ts                 # 收藏列表
│   └── useVideoCover.ts                # 浏览器抽帧 fallback
├── store/                              # zustand
│   ├── uiStore.ts                      # 主题 / 强调色 / 侧边栏 / 视图模式（localStorage）
│   ├── libraryStore.ts                 # 最近一次扫描结果（内存）
│   ├── viewerStore.ts                  # 查看器临时状态（sessionStorage）
│   └── searchStore.ts                  # 排序 / 视图 / 年份筛选（localStorage）
├── routes/                             # 页面
│   ├── Home.tsx                        # 主页（年份时间线 + 全库网格）
│   ├── Album.tsx                       # 单个 album / collection
│   ├── Author.tsx                      # 标签页 /tags/<tag>
│   ├── Viewer.tsx                      # 查看器 /viewer?type=&path=&index=
│   ├── Recents.tsx / Favorites.tsx     # 最近 / 收藏
│   └── Settings.tsx                    # 设置（含服务端配置）
├── components/
│   ├── layout/                         # AppShell / Sidebar / Toolbar / StatusBar / Breadcrumb
│   ├── album/                          # AlbumGrid / AlbumCard / ContextMenu / ScanProgress
│   ├── home/                           # YearTimeline（海报式 4:5 卡片）
│   ├── viewer/                         # ImageViewer / VideoPlayer / ViewerToolbar / ImageInfoPanel / PageSlider / TranscodeProgress
│   └── common/                         # EmptyState / HelpOverlay / PropertiesDialog / ThemeSwitcher / VideoCoverImage / HoverPreview / TranscodeStatusBadge / GlobalSearch / ListFilterBar / Popover / CopyButton / Toast / Icon
└── utils/
    ├── shortcuts.ts                    # 单一来源
    ├── path.ts                         # 路由 ↔ 相册路径编解码
    ├── storage.ts                      # sessionStorage 包装
    ├── format.ts                       # 字节 / 时长
    ├── date.ts                         # timeAgo
    ├── albumGrouping.ts                # 按年份聚合
    └── viewerContext.ts                # 跨卷翻页上下文
```

### 3.1 状态分层

| 数据 | 存储 | 跨设备 |
|------|------|--------|
| 主题 / 强调色 / 侧边栏 / 视图模式 | localStorage | ❌ |
| 排序 / 年份筛选 / 搜索词 | localStorage | ❌ |
| 查看器当前页码 / 缩放 | sessionStorage | ❌（关标签页清） |
| 收藏 / 最近 / 阅读进度 | 服务端 JSON | ✅ |
| 扫描结果 | 内存（`libraryStore`） | ❌（重启清） |
| 偏好（主题 / maxRecent / autoSwitchAlbum） | 服务端 JSON | ✅ |

设计原则：**用户能看到的状态走服务端，UI 临时状态走浏览器**。换设备收藏还在，主题还是用户偏好的那个。

### 3.2 路由

```
/                          Home（主页）
/albums/<encoded-path>     Album 详情
/albums/                   集合（多 album 上层目录）
/tags/<tag>                Author / 智能合集
/viewer?type=image&...     Image Viewer
/viewer?type=video&...     Video Player
/recents                   最近
/favorites                 收藏
/settings                  设置
```

查看器用 query string 而不是 path param，因为图片列表 URL 太长会超 8KB（nginx 默认）。

### 3.3 主题实现

```ts
// useTheme.ts
useEffect(() => {
  const resolved = theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme
  document.documentElement.setAttribute('data-theme', resolved)
}, [theme])
```

```css
/* tailwind.config.ts */
darkMode: ['class', '[data-theme="dark"]']
```

```css
/* styles.css */
:root { --bg: #fafaf9; --fg: #18181b; ... }
[data-theme="dark"] { --bg: #0c0a09; --fg: #fafaf9; ... }
```

主题切换 → 改一个 attribute → CSS 变量重算 → 一次 reflow。**不需要重渲染组件树**。

### 3.4 性能取舍

| 场景 | 取舍 |
|------|------|
| 缩略图懒加载 | `loading="lazy"` + `IntersectionObserver`，避免一次拉满 |
| 100+ album 网格 | `react-virtuoso` 虚拟滚动 |
| 大图 | 原图按需 Range 加载 |
| 缩略图缓存 | LRU 100/500 + 磁盘，命中 < 1ms |
| 扫大库 | 后端 worker pool + SSE，前端不阻塞 |
| 视频转码 | 不阻塞 UI，原文件先发，SSE 推进度 |
| HelpOverlay | 搜索输入即时过滤（SHORTCUTS 数组 < 50 项，O(n) 完全够用） |

---

## 4. 数据流详解

### 4.1 启动

```
main()
  ├─ flag.Parse()                           # --config / --static-dir
  ├─ config.LoadFile(config.yaml)
  ├─ cfg.Validate()                         # mediaRoots 必须存在
  ├─ lookupFFmpeg(cfg)                      # 探测或显式路径
  ├─ 构造 services:                         # 见 §2
  │    scanner, scan_runner, thumbnail,
  │    video_cover, video_info,
  │    video_faststart, video_transcode
  ├─ 构造 handlers: handlers.New(...)
  ├─ 构造 config.Manager（订阅热更新）
  ├─ fiber.New() + Use(logger/recover/path_safety)
  ├─ 注册 /api/* 路由（含 /api/albums 兼容别名）
  └─ app.Listen(cfg.Addr())
```

### 4.2 扫描（异步 + SSE）

```
POST /api/scan/start
  → scan_runner.Start({paths: cfg.MediaRoots, maxDepth: cfg.MaxDepth})
    → uuid.New() → scanId
    → 状态: state = { Events: chan, Cancel: cancelFn }
    → goroutine:
        scanner.ScanWithHook(...)
          → filepath.WalkDir
          → worker pool 处理每个子目录
            → 生成 Album
            → hook(ProgressEvent{Progress, AlbumsFound}) → 推 channel
          → smart_group.GroupByTag(albums)
          → scan_cache.Set(result)
          → 推 ProgressEvent{Status: complete}
    ← 立即返回 { scanId }

GET /api/scan/:id/events
  → runner.Get(id) → state.Events
  → SetBodyStreamWriter:
      for ev := range state.Events {
        fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, ev.Data)
        w.Flush()
      }
```

### 4.3 翻一张图

```
GET /api/folders?path=<abs>
  → middleware.SafePath                    # 多根 OR + 越权拦截
  → cache.FindAlbum / FindCollection / FindSmart
  → 返回结构化 JSON

GET /api/thumbs?path=<abs>
  → middleware.SafePath
  → thumbnail.GetOrCreate(path)
    → memCache.Get → 命中返回（O(1)）
    → 磁盘读 → 命中则回填 memCache
    → 都没命中 → imaging.Fit 生成（图片）
                → video_cover.Extract（视频，ffmpeg）
    → 写盘 + memCache.Add

GET /api/images?path=<abs>
  → c.SendFile(path, true)                 # Fiber 内置 Range 支持
  → 浏览器按需下载
```

### 4.4 播放一个视频

```
GET /api/videos/info?path=<abs>
  → videoInfo.Info(path)                   # ffprobe 读容器元数据
  → 返回 duration / width / height / codec / bitRate
  → 同时附 transcodeStatus（not_needed / cached / queued / running / failed）

[前端] 检测到 transcode.needed && !cached:
  → 订阅 /api/videos/transcode/events?path=...
  → 同时请求 /api/videos?path=...  # 服务端会发原文件
  → 视频元数据丰富 / 也许浏览器能硬解

GET /api/videos?path=<abs>
  → transcode.Resolve(path)                # H.1 优先
  → faststart.Resolve(path)                # H.2
  → 原文件 fallback                        # H.3
  → c.SendFile(resolved, true)             # Range + ETag

[服务端转码完成]
  → SSE 推 done 事件
  → 前端 unsubscribe + 重挂载 <video src=...>
```

---

## 5. 性能

| 场景 | 优化 | 实测 |
|------|------|------|
| 大型扫描 | goroutine pool + worker queue | 500+ album 不卡 UI |
| 缩略图首字节 | LRU 100 / 500 + 磁盘 | 命中 < 1ms，未命中 30-80ms |
| 视频封面（ffmpeg） | `-ss` before `-i` | 339ms / 380MB H.264 |
| 视频封面（浏览器 fallback） | canvas 抽帧 | 30+ 秒 / 400MB+ 内存 |
| ffprobe 元数据 | 一次进程 | 1GB 视频 50-150ms |
| 缩略图前端 | IntersectionObserver 懒加载 | 首屏 < 200ms |
| 大列表 | react-virtuoso | 1000+ 卡片 60fps |
| 主题切换 | CSS 变量 | 一次 reflow，0 组件 re-render |
| 路由跳转 | 查询参数 | URL 不超 8KB |
| 视频流 | Range + ETag | 拖进度条不重传 |

### 瓶颈

- **缩略图磁盘读**：< 1ms 是 LRU 命中，磁盘读约 5-15ms（机械盘）—— 大库还是建议把 `cacheDir` 放 SSD
- **ffmpeg 转码**：CPU bound，单核 1x 实时 → 4K HEVC 10-20min，机器差会更久。`max(1, NumCPU/2)` 并发上限保护机器
- **首屏渲染**：从 `/api/scan/latest` 取缓存结果（重启后为空）→ 触发 `/api/scan/start` 异步扫 → SSE 推进度。空状态用 `EmptyState` 占位

---

## 6. 部署

### 6.1 单端口（推荐）

```bash
cd frontend && npm run build              # 产物在 frontend/dist
cd ../backend && go build -o ../bin/server ./cmd/server
./bin/server                              # 默认 :8080
```

后端用 `c.Static()` 托管 `staticDir`：

```go
// main.go
if dir := cfg.StaticDir; dir != "" {
    if _, err := os.Stat(dir); err == nil {
        app.Static("/", dir)
        // SPA fallback: 未匹配的路径回 index.html
        app.Get("*", func(c *fiber.Ctx) error {
            return c.SendFile(filepath.Join(dir, "index.html"))
        })
    }
}
```

### 6.2 反代（可选）

如果要前置 nginx（SSL、限流、多服务共用）：

```nginx
location / {
    root /var/www/image-viewer;
    try_files $uri /index.html;
}
location /api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_buffering off;     # SSE 必需
    proxy_http_version 1.1;
    proxy_set_header Connection "";
}
```

> `proxy_buffering off` 是 SSE 的硬要求，否则事件被缓冲到 4KB 才 flush，前端永远看不到进度。

### 6.3 systemd（可选）

```ini
# /etc/systemd/system/image-viewer.service
[Unit]
Description=Image Viewer
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/image-viewer
ExecStart=/opt/image-viewer/server
Restart=on-failure
Environment=CONFIG_PATH=/etc/image-viewer/config.yaml

[Install]
WantedBy=multi-user.target
```

---

## 7. 域对照（v1 → v2）

| v1 漫画阅读器 | v2 图像浏览器 |
|---------------|---------------|
| 漫画 / 本 / 卷 | 文件夹 |
| 页 | 张 |
| 作者 | 标签 |
| 作者集合 | 智能合集 |
| 阅读模式 | 显示模式 |
| 单页 / 双页对开 | 单张 / 双张并排 |
| 漫画根 `comicRoot` | 媒体根 `mediaRoots[]` |
| `.comic-reader/` 缓存 | `.image-viewer/` 缓存 |
| `ComicReader.exe` | `image-viewer` / `server` |
| `<Route path="/authors/*">` | `<Route path="/tags/:tag">` |

旧名（`comicRoot` / `Author` / `/authors/*`）仍可识别，便于旧链接与缓存迁移。
