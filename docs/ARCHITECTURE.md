# 架构文档

## 总览

```
┌──────────────────────────┐       ┌────────────────────────────┐
│  Browser (React SPA)     │  HTTP │  Backend (Go + Fiber)      │
│                          │ ────► │                            │
│  • Vite + React 18 + TS  │       │  • 路由 /api/*             │
│  • 路由 / 状态 / UI      │  SSE  │  • 扫描服务 + 缩略图缓存   │
│  • 虚拟滚动 / 主题       │ ◄──── │  • 异步任务调度           │
│  • 查看器 / 幻灯片       │       │  • 路径安全 / 偏好持久化   │
└──────────────────────────┘       └────────────────────────────┘
                                            │
                                            ▼
                                  ┌──────────────────────────┐
                                  │  文件系统 (图像根目录)    │
                                  │  E:\图像 → ./images       │
                                  └──────────────────────────┘
```

## 领域模型

应用对**目录与媒体类型保持中性**，核心抽象是"媒体组"：

- **文件夹 (Album)**：一个包含若干媒体文件（图片 + 视频）的子目录。
  - `ImageFiles` / `imageCount` + `VideoFiles` / `videoCount` 同时记录
  - `CoverKind` 标识封面源（"image" / "video"），`CoverImage` 指向对应文件
- **集合 (Collection)**：上层目录（深度可达 `MaxDepth`），把若干文件夹收作卷册。
- **智能合集 (SmartCollection)**：按**标签**（从目录名中 `[xxx]` 段提取）聚合的所有文件夹。
  - 一个文件夹可以属于多个智能合集（多个标签）。
  - 兼容历史：旧字段 `Author` 仍存在，但内容等同于第一个标签。

### 视频封面流程

视频（mp4/webm/mov/mkv/avi/m4v）的"封面"v2 改在服务端用 ffmpeg 抽帧，浏览器只负责展示：

```
[首次访问视频 cover + ffmpeg 可用]
  GET /api/thumbs?path=<video>
    → 缓存未命中,ThumbnailService 调 VideoCoverExtractor.Extract
    → ffmpeg 子进程: -ss <seek> -i <input> -frames:v 1 -vf "scale+pad" -f image2pipe mjpeg
    → 服务端 imaging.Fit 标准化 + 写盘 + LRU 入库
    → 返回 JPEG
[首次访问视频 cover + ffmpeg 不可用]
  GET /api/thumbs?path=<video>
    → 缓存未命中 + ffmpeg 抽帧失败 → 404 { code: "video_cover_missing" }
  前端 useVideoCover 捕获:
    1) fetch <video> 字节（/api/videos 支持 Range）
    2) <video> 元素 seek 到 ~duration * 10%（夹到 1~3s）
    3) canvas.drawImage + canvas.toBlob('image/jpeg', 0.85)
    4) POST /api/thumbs/cover (原始字节)
  → 后端 imaging.Fit → 缓存到 disk + LRU
[后续访问]
  GET /api/thumbs?path=<video> → 命中缓存,直接返回 JPEG
```

**为什么服务端 ffmpeg 比浏览器抽帧快？**

- 浏览器抽帧需要先把整段视频下载到内存(几百 MB-几 GB),然后再 seek、drawImage、toBlob、上传;IO + 内存占用 + 多次跨进程都是瓶颈
- ffmpeg `-ss` 在 `-i` 之前(快速 seek):只解码目标位置附近的几帧,不必解析整段容器。对 380MB / 176s / 1280×720 H.264 视频实测 339ms;缓存命中 < 1ms
- 服务端集中式抽帧可以利用 ffmpeg 的多线程解码、H.264 硬件加速(NVENC/QSV/VideoToolbox) 等浏览器拿不到的能力

### 视频元数据

`/api/videos/info` 现在用 ffprobe 一次性返回 duration / width / height / codec / container / bitRate;
旧版本完全依赖前端 `<video>` 元素的 `loadedmetadata` 事件,延迟到点击播放之后。新版本在列表卡片渲染时就能拿到时长,无需等视频加载。

## 后端模块（Go）

```
backend/
├── cmd/server/main.go          # 入口：YAML 加载 + 服务装配
├── internal/
│   ├── config/                 # YAML 配置加载 + 校验
│   ├── models/                 # 领域模型（Album、Collection、SmartCollection、Prefs）
│   │                          # Album 序列化时同时输出 files/imageFiles + videoFiles
│   │                          # CoverKind 标识封面源（image/video）
│   ├── services/               # 业务逻辑
│   │   ├── scanner.go          # 文件遍历 + goroutine worker pool（图/视频同收集）
│   │   ├── smart_group.go      # 按标签智能分组（GroupByTag）
│   │   ├── thumbnail.go        # LRU + 磁盘缓存 + Lanczos + 视频封面 save
│   │   ├── scan_runner.go      # 异步扫描 + SSE 推送
│   │   └── image_info.go       # 尺寸/格式/checksum
│   ├── store/                  # JSON 偏好持久化（原子写）
│   ├── handlers/               # Fiber 路由处理
│   │   ├── thumbs.go           # GET /api/thumbs + POST /api/thumbs/cover
│   │   ├── videos.go           # GET /api/videos + GET /api/videos/info
│   │   └── ...                 # albums / scan / config / fs / prefs / images
│   └── middleware/             # logger / recover / path_safety
└── tests/integration/          # 端到端 HTTP 测试（app.Test）
```

## 前端模块（React）

```
frontend/src/
├── api/                        # fetch 封装 + 端点模块
│   ├── client.ts               # api<T> / sse / ApiError
│   ├── scan.ts thumbs.ts prefs.ts images.ts imageInfo.ts fs.ts
├── hooks/                      # 复用 hooks
│   ├── useKeyboard.ts          # 全局快捷键
│   ├── useScanSSE.ts           # 扫描 SSE 订阅
│   ├── useTheme.ts             # 主题切换
│   ├── useReadingProgress.ts   # 单条/批量阅读进度
│   └── useFavorites.ts         # 收藏列表
├── store/                      # zustand
│   ├── uiStore.ts              # 侧边栏/主题（localStorage 持久化）
│   ├── libraryStore.ts         # 最近一次扫描结果（共享）
│   └── viewerStore.ts          # 查看器临时状态（sessionStorage）
├── routes/                     # 页面
│   ├── Home.tsx                # 主页（文件夹/合集/标签/最近）
│   ├── Album.tsx               # 单个文件夹或合集详情
│   ├── Author.tsx              # 标签页（/tags/<tag>）
│   ├── Viewer.tsx              # 查看器（/viewer?path=…）
│   ├── Recents.tsx / Favorites.tsx / Settings.tsx
├── components/
│   ├── layout/                 # AppShell / Sidebar / Toolbar / StatusBar / Breadcrumb
│   ├── album/                  # AlbumGrid / AlbumCard / ContextMenu / ScanProgress
│   ├── viewer/                 # ImageViewer / VideoPlayer / ViewerToolbar / ImageInfoPanel
│   └── common/                 # EmptyState / HelpOverlay / PropertiesDialog / ThemeSwitcher / VideoCoverImage / HoverPreview
└── utils/                      # 工具
    ├── shortcuts.ts            # 快捷键清单（单一来源）
    ├── path.ts                 # 路由与相册路径编解码（/albums/、/tags/、smart: 前缀）
    ├── storage.ts              # sessionStorage 持久化
    └── format.ts               # 字节大小 / 视频时长格式化
```

## 关键流程

### 1. 启动

```
main()
  ├─ flag.Parse()                      # 仅 --config / --static-dir
  ├─ config.LoadFile(config.yaml)      # YAML 覆盖默认
  ├─ cfg.Validate()                    # MediaRoot 必须存在且为目录
  ├─ fiber.New() + Use(logger/recover/path_safety)
  ├─ 注册 /api/* 路由（含 /api/folders、/api/tags 别名）
  └─ app.Listen(cfg.Addr())
```

### 2. 扫描（异步）

```
POST /api/scan/start
  → runner.Start(opts)
    → uuid.New() 生成 scanId
    → goroutine: scanner.ScanWithHook(opts, hook)
      → filepath.WalkDir → worker pool → 发现文件夹 → 推送 ProgressEvent
      → smart_group.GroupByTag()           # 提取 [tag] 段并分组
      → 写 final ProgressEvent(ScanStatusComplete)
  ← { scanId }

GET /api/scan/:id/events (SSE)
  → runner.Get(id) → state.Events (chan)
  → SetBodyStreamWriter: for ev := range state.Events { fmt.Fprintf(w, "event: ...") }
```

### 3. 查看图片

```
GET /api/folders?path=<abs>          # 新名（兼容 /api/albums）
  → middleware.SafePath (path_safety 校验；smart: 前缀绕过绝对路径检查)
  → cache.FindAlbum / FindCollection / FindSmartCollection
  → 返回 Album 或 Collection 或 Smart 的详情

GET /api/tags?path=smart:<tag>        # 按标签名直接查询智能合集

GET /api/thumbs?path=<abs>
  → middleware.SafePath
  → thumbs.GetOrCreate(path)
    → LRU.Get(key)   ← 内存命中
    → 磁盘缓存读     ← 未命中但文件存在
    → imaging.Fit    ← 重新生成
  → c.Send(png)

GET /api/images?path=<abs>
  → c.SendFile(path)  // 内置 Range 支持
```

### 4. 路径安全

所有 `?path=` 请求经 `path_safety` 中间件：

- `filepath.IsAbs(path)` 必须为真
- `filepath.Rel(root, abs)` 结果不以 `..` 开头
- **`smart:` 前缀**：直接放行，不做绝对路径校验（用于智能合集查询）
- 校验失败：400

### 5. 偏好持久化

```
PATCH /api/prefs → PrefsStore.Update(p)
  → tmp 文件写入 → os.Rename(tmp, settings.json)  // 原子替换
```

### 6. 主题切换

```
Toolbar ThemeSwitcher → useUIStore.setTheme(t)
  → useTheme() hook → documentElement.setAttribute('data-theme', t)
  → tailwind: darkMode: ['class', '[data-theme="dark"]'] → CSS 变量切换
```

## 性能要点

| 场景 | 优化 |
|------|------|
| 大型扫描 | goroutine pool (`min(8, NumCPU)`) + worker queue |
| 缩略图首字节 | LRU 100 + 磁盘缓存（按 mtime 失效） |
| 缩略图前端 | `IntersectionObserver` 懒加载 + `loading="lazy"` |
| 大列表 | `react-virtuoso` 虚拟滚动（>100 启用） |
| SSE | `bufio.Writer` + flush 每事件 |
| 主题切换 | CSS 变量 → 一次 reflow，无需重渲染组件树 |
| 路由跳转 | 查看器通过 `?path=&index=&name=` 跳转，避免图片列表 URL 超长 |

## 部署

```bash
# 后端
cd backend
cp config.example.yaml config.yaml
# 编辑 config.yaml，设置 mediaRoots（数组，支持多个根目录）
go build -o image-viewer ./cmd/server
./image-viewer

# 前端
cd frontend
npm run build
# 将 dist/ 静态部署到 Nginx/Caddy，并与 image-viewer 反向代理在同一域
```

生产配置示例：

```nginx
location / {
  root /var/www/image-viewer;
  try_files $uri /index.html;
}
location /api/ {
  proxy_pass http://127.0.0.1:8080;
  proxy_buffering off;     # SSE 必需
}
```

## 术语对照

| 旧（v1 漫画阅读器） | 新（图像浏览器 / Viewer） |
|--------------------|--------------------------|
| 漫画 / 本 / 卷 | 文件夹 |
| 页 | 张 |
| 作者 | 标签 |
| 作者集合 | 智能合集 |
| 阅读模式 | 显示模式 |
| 单页 / 双页对开 | 单张 / 双张并排 |
| 原版日漫（右→左） | 右→左（适合从右到左的出版物） |
| 漫画根 (`comicRoot`) | 图像根 (`mediaRoot`) |
| `.comic-reader/` 缓存 | `.image-viewer/` 缓存 |
| `ComicReader.exe` | `image-viewer.exe` |

旧名（`comicRoot`、`Author`、`<Route path="/authors/*">`）仍可识别，便于旧链接与缓存迁移。
