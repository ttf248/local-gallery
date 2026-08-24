# FEATURES · 全功能清单

> 本地画廊（Local Gallery）所有功能的权威清单，按域分组。每一项指向代码位置。
> 想加新功能？先在这里找定位，再决定属于哪个域。

---

## 0. 目录

- [1. 库与扫描](#1-库与扫描)
- [2. 缩略图与缓存](#2-缩略图与缓存)
- [3. 视频处理](#3-视频处理)
- [4. 图片画廊](#4-图片画廊)
- [5. 视频播放器](#5-视频播放器)
- [6. 导航与发现](#6-导航与发现)
- [7. 收藏 / 最近 / 未读 / 进度](#7-收藏--最近--未读--进度)
- [8. 主题与外观](#8-主题与外观)
- [9. 快捷键与帮助](#9-快捷键与帮助)
- [10. 系统集成](#10-系统集成)
- [11. 路径安全](#11-路径安全)
- [12. 配置管理](#12-配置管理)

---

## 1. 库与扫描

| 功能 | 描述 | 位置 |
|------|------|------|
| 多根目录 | `mediaRoots[]` 数组，所有根下的非空子目录合并成一个全局库 | `backend/internal/config/config.go` `Config.MediaRoots` |
| 旧名兼容 | `mediaRoot`（单数）/ `comicRoot` 仍可识别为单元素数组 | `config.LoadFile` |
| 异步扫描 | `POST /api/scan/start` 立即返回 `scanId`，后台 goroutine 跑 | `internal/services/scan_runner.go` |
| SSE 进度推送 | `GET /api/scan/:id/events` 推送 `running` / `complete` / `cancelled` / `error` 事件 | `handlers/scan.go` `ScanEventsHandler` |
| 可取消扫描 | `DELETE /api/scan/:id` 取消正在跑的扫描 | `scan_runner.go` `Cancel(id)` |
| worker pool | `min(8, NumCPU)` 并发处理目录，元数据 + 缩略图一并生成 | `internal/services/scanner.go` |
| 标签智能合集 | 从目录名提取 `[xxx]` 段作为标签，跨卷聚合 | `internal/services/smart_group.go` `GroupByTag` |
| 最近一次扫描缓存 | `GET /api/scan/latest` 立即返回上次结果，无需重扫 | `handlers/scan.go` `LatestScanHandler` |
| 同步扫描（小库） | `POST /api/scan` 阻塞返回完整结果 | `handlers/scan.go` `ScanSyncHandler` |
| 按路径取详情 | `GET /api/folders?path=<abs>` 返回 album / collection / smart | `handlers/albums.go` |
| 智能合集查询 | `?path=smart:<tag>` 直查智能合集 | 同上 |
| **扫描排除规则** | 跳过隐藏目录 + 系统白名单 + 用户 glob 模式列表，目录树不进库 | `internal/services/exclude.go` `ExcludeConfig` |
| 模糊搜索 | `GET /api/search?q=<kw>` 模糊匹配 name / tag，不区分大小写 | `handlers/albums.go` `SearchHandler` |

---

## 2. 缩略图与缓存

| 功能 | 描述 | 位置 |
|------|------|------|
| LRU 内存缓存 | 默认 500 项，O(1) 命中 | `internal/services/thumbnail.go` `hashicorp/golang-lru/v2` |
| 磁盘缓存 | `<cacheDir>/thumbs/<md5>.jpg` | `thumbnail.go` `cachePathFor` |
| Lanczos 重采样 | `disintegration/imaging` Fit，按 mtime 失效 | `thumbnail.go` `imaging.Fit` |
| 视频封面抽帧 | ffmpeg `-ss <seek> -i <video> -frames:v 1`，写入缩略图缓存 | `internal/services/video_cover.go` |
| 浏览器抽帧 fallback | ffmpeg 不可用 / 抽帧失败时，前端 `<video>` + canvas 抽帧后 `POST /api/thumbs/cover` 上传 | `frontend/src/hooks/useVideoCover.ts` |
| 缩略图统计 | `GET /api/thumbs/stats` 命中率、占用 | `handlers/cache.go` |
| 过期清理 | `POST /api/thumbs/cleanup` 清掉超过 `cacheMaxAgeDays` 的 | `handlers/cache.go` |
| HEIC/HEIF 直出 | 原图 `image/heic` MIME 直给浏览器（Safari 16+ 支持） | `handlers/images.go` |
| 懒加载 | `<img loading="lazy" decoding="async">` + 卡片 `IntersectionObserver` | 前端各组件 |

### 抽帧性能（实测，1280×720 H.264 / 380 MB / 176 s）

| 方案 | 首次 | 命中 | 客户端内存 |
|------|------|------|----------|
| 浏览器抽帧（v1） | 30+ 秒 | < 50 ms | 400 MB+ |
| 服务端 ffmpeg（v2） | **339 ms** | **< 1 ms** | 0 |

---

## 3. 视频处理

视频是本项目最硬核的部分。`/api/videos?path=...` 一次请求经过 4 层 fallback：

```
请求 → TranscodeService → FaststartService → 原文件
        (冷门编码→H.264)  (moov 在末尾)    (兜底)
```

### 3.1 元数据（ffprobe）

| 功能 | 描述 | 位置 |
|------|------|------|
| 视频元信息 | `GET /api/videos/info?path=...` 返回 duration / width / height / codec / container / bitRate | `handlers/videos.go` `VideoInfoHandler` |
| ffprobe 可选 | 没装也不报错，旧版本依赖 `<video>` 加载完才能拿 metadata | `internal/services/video_info.go` |
| ffprobe 失败容错 | 返回 `probeError` 字段而不是 5xx，前端可继续播放 | `video_info.go` `VideoInfoService.Info` |

### 3.2 抽帧封面（ffmpeg）

| 功能 | 描述 | 位置 |
|------|------|------|
| `-ss` before `-i` | 快速 seek，只解码目标位置附近几帧 | `internal/services/video_cover.go` |
| 动态 seek | seek 到 `duration × 10%`，夹到 1\~3s | `VideoCoverExtractor.Extract` |
| 缓存复用 | 命中 LRU / 磁盘后直接返回 JPEG | `thumbnail.go` |

### 3.3 Faststart（remux）

| 功能 | 描述 | 位置 |
|------|------|------|
| 自动检测 | 读文件头判断 moov 在前 / 在后 | `internal/services/video_faststart.go` |
| remux | 已经在前 → 直接发原文件；不在前 → `ffmpeg -c copy` 写到缓存 | `FaststartService.Resolve` |
| 缓存 key | `md5(path|mtime|size)` | `faststart.go` `CacheKeyFromStat` |
| 静默回退 | ffmpeg 不可用就当原文件发，不阻断播放 | `VideoHandler` |

### 3.4 自动转码（H.264 + AAC）

| 功能 | 描述 | 位置 |
|------|------|------|
| codec 判定 | h264/vp9/vp8 + mp4/webm/m4v/mov → 跳过；av1/hevc/prores/未知 → 转码 | `internal/services/video_transcode.go` `needsTranscode` |
| 目标参数 | mp4 / H.264 High@L4.1 / AAC LC 128k / faststart / CRF 22 | `TranscodeService.Profile()` |
| singleflight | 同一 key 同一时刻只跑一个 ffmpeg | `golang.org/x/sync/singleflight` |
| 全局并发限流 | sem 信道，容量 = `max(1, NumCPU/2)`，可被配置覆盖 | `TranscodeService.sem` |
| 缓存 key | `md5(path|mtime|size|profile)` | `transcode.go` `TranscodeKey` |
| 状态查询 | `GET /api/videos/transcode/status` → `not_needed` / `cached` / `queued` / `running` / `failed` / `unavailable` | `handlers/transcode.go` `TranscodeStatusHandler` |
| SSE 进度 | `GET /api/videos/transcode/events` 推 `progress` / `done` 事件，30s 心跳 | `TranscodeEventsHandler` |
| 可取消 | `POST /api/videos/transcode/cancel?path=...` 取消中 ffmpeg（SIGTERM） | `TranscodeCancelHandler` |
| 缓存统计 | `GET /api/videos/transcode/cache/stats` → 路径 / 字节数 / 文件数 | `TranscodeCacheStatsHandler` |
| 缓存清理 | `POST /api/videos/transcode/cache/clear?maxBytes=&maxAgeDays=` | `TranscodeCacheClearHandler` |
| 失败模式 | ffmpeg 不可用 / 启动失败 / 转码失败 / 源文件被删 / 磁盘满 → 全部静默回退到原文件 | `transcode.go` `Resolve` |
| 前端状态展示 | 列表卡片上的 `TranscodeStatusBadge` + 播放页 `TranscodeProgress` 覆盖层 | `components/common/TranscodeStatusBadge.tsx` `components/viewer/TranscodeProgress.tsx` |

### 3.5 视频流

| 功能 | 描述 | 位置 |
|------|------|------|
| Range 支持 | `Accept-Ranges: bytes` + `206 Partial Content`，浏览器拖进度条不重传 | `handlers/videos.go` `VideoHandler` |
| ETag 协商 | `<mtime_ns>-<size>`，304 Not Modified 后浏览器复用本地 Range 段 | `videos.go` |
| 1 天 Cache-Control | `public, max-age=86400` | `videos.go` |
| MIME 映射 | mp4/webm/quicktime/matroska/avi/m4v | `videos.go` |

### 3.5b 原图流

| 功能 | 描述 | 位置 |
|------|------|------|
| ETag 协商 | `<mtime_ns>-<size>`，命中 304 不传 body | `handlers/images.go` `imageETag` |
| 1 天 Cache-Control | `public, max-age=86400` | `images.go` |
| HEIC 直出 | Safari 原生解码；Chrome/Firefox 由浏览器决定 | `images.go` |

---

## 4. 图片画廊

| 功能 | 描述 | 位置 |
|------|------|------|
| 3 种显示模式 | 单张 / 连续滚动 / 双张并排（`1` / `2` / `3` 切换） | `routes/Gallery.tsx` `components/gallery/ImageGallery.tsx` |
| 4 套 fit | 适应 / 按宽 / 按高 / 原始（`F` 循环） | `ImageGallery.tsx` `fitMode` |
| 翻页方向 LTR/RTL | 双张并排模式按 `L` 切换 | `ImageGallery.tsx` |
| 缩放 | `+` / `-` / `0`（实际大小） | `ImageGallery.tsx` |
| 旋转 | `R` 90° | `ImageGallery.tsx` |
| 跳到指定页 | `G` 唤起输入框 + 回车 | `Gallery.tsx` |
| 跳到首/尾 | `Home` / `End` | `ImageGallery.tsx` |
| 翻页 | `←` / `→` / `PageUp` / `PageDown`，连续模式为滚一屏 | `ImageGallery.tsx` |
| 点击图片分区域 | 左 1/3 上一张 / 右 1/3 下一张 / 中段无响应（防误触） | `ImageGallery.tsx` `onClick` |
| 缩略图跳页 | 底部滑块拖拽时浮出 5 张缩略图条 | `components/viewer/PageSlider.tsx` |
| 幻灯片 | `Space` 启停，自动翻页 | `ImageGallery.tsx` `slideshowTimer` |
| 全屏 | `F11`（也走原生 Fullscreen API） | `ImageGallery.tsx` |
| 信息面板 | `I` 切换：路径 / 尺寸 / 格式 / 大小 / mtime | `components/viewer/ImageInfoPanel.tsx` |
| 跨卷翻页 | `N` / `P` 按当前列表顺序（主页 / 收藏 / 标签 / 集合） | `Gallery.tsx` |
| 收藏切换 | `S` 收藏 / 取消收藏 | `Gallery.tsx` |
| 错误兜底 | 加载失败显示重试按钮 + 中文 MediaError 翻译 | `components/gallery/ImageGallery.tsx` |
| 退出优先级 | `Esc` 链：退出全屏 → 关信息面板 → 关帮助 → 返回上一页 | `Gallery.tsx` |

---

## 5. 视频播放器

| 功能 | 描述 | 位置 |
|------|------|------|
| 原生 controls | 浏览器自带控制条 + 自定义快捷键增强 | `components/viewer/VideoPlayer.tsx` |
| 增强快捷键 | `Space`/`K` 播放暂停，`←`/`→` ±5s，`↑`/`↓` 音量 ±10%，`M` 静音 | `VideoPlayer.tsx` `useKeyboard` |
| 视频时长显示 | 列表卡片渲染时显示（ffprobe 元数据，不再等 `<video>` 加载） | `components/common/VideoCoverImage.tsx` |
| 转码进度覆盖层 | 转码中时在 `<video>` 上方盖一层「视频正在转码 30% 预计 3 分钟」 | `components/viewer/TranscodeProgress.tsx` |
| 转码状态订阅 | 打开视频时订阅 `/api/videos/transcode/events` | `VideoPlayer.tsx` |
| 错误兜底 | 加载失败 / 转码失败显示重试按钮 | `VideoPlayer.tsx` |
| 全屏 | `F11` | `VideoPlayer.tsx` |

---

## 6. 导航与发现

| 功能 | 描述 | 位置 |
|------|------|------|
| 主页 | 年份时间线 + 全库网格 | `routes/Home.tsx` |
| 年份时间线 | 4:5 海报式卡片，2x2 拼图，多余显示 `+N 更多` | `components/home/YearTimeline.tsx` |
| 年份筛选 | 右上角漏斗按钮 / 主页多 album 年份主点击触发，激活时高亮 | `YearTimeline.tsx` + `store/searchStore.ts` |
| 视图模式 | grid / list 切换 | `store/uiStore.ts` `viewMode` |
| 排序 | 名称 / 张数 / 最近 | `store/searchStore.ts` `sortBy` |
| 排序 + 视图 + 计数 | 三件套统一在 `ListFilterBar` 顶部 | `components/common/ListFilterBar.tsx` |
| 全局搜索 | `Ctrl+P` 或 `/` 聚焦，模糊匹配 name / 标签 | `components/common/GlobalSearch.tsx` |
| 排序：按最近看 | 用 `history.openedAt` 而非文件 mtime 排序（区别于"最近改"） | `routes/Home.tsx` + `searchStore` |
| 全局最小图数 filter | 隐藏图数 < N 的杂物相册（0 = 不过滤） | `components/common/ListFilterBar.tsx` `MinImageFilter` |
| 侧边栏 | 主页 / 最近 / 收藏 / 设置 + 随机一本按钮 | `components/layout/Sidebar.tsx` |
| 折叠侧边栏 | `Ctrl+B` 切换 | `Sidebar.tsx` |
| 随机一本 | `R` / 侧边栏按钮 → 在 `result.albums` 随机抽一个 | `Sidebar.tsx` `onShuffle` |
| 悬停预览 | 240×300 portal 大卡，进度条 / 上次阅读 / 张数 | `components/common/HoverPreview.tsx` |
| 智能避让 | 悬停预览自动避让视口边缘（左 / 右、上 / 下） | `HoverPreview.tsx` |
| 面包屑 | 主页 / 集合 / 专辑 / 画廊四级 | `components/layout/Breadcrumb.tsx` |
| 状态栏 | 底部显示"已就绪 / 阅读中"指示 | `components/layout/StatusBar.tsx` |
| 面包屑 / 工具栏 | 顶部导航条 | `components/layout/Toolbar.tsx` `AppShell.tsx` |
| 文件夹详情 | `/albums/<path>` 单 album 全部文件 + 视频混合 | `routes/Album.tsx` |
| 标签页 | `/tags/<tag>` 智能合集详情 | `routes/Author.tsx` |
| 集合页 | 上层目录的合集 | `routes/Album.tsx` (`variant: collection`) |
| 最近 | `/recents` 10 条 LRU | `routes/Recents.tsx` |
| 收藏 | `/favorites` | `routes/Favorites.tsx` |

---

## 7. 收藏 / 最近 / 未读 / 进度

| 功能 | 描述 | 位置 |
|------|------|------|
| 收藏 | `POST /api/favorites` 幂等添加 | `handlers/favorites.go` |
| 收藏移除 | `DELETE /api/favorites?path=...` 幂等 | `handlers/favorites.go` |
| 收藏 prune | `POST /api/favorites/prune` 移除磁盘上已不存在的 | `handlers/favorites.go` |
| 跨设备持久化 | 服务端 JSON 存储（原子写 tmp + rename） | `internal/store/prefs.go` |
| 最近访问 | `POST /api/history` LRU 去重，最多 `maxRecent` 条（默认 10） | `handlers/prefs.go` |
| 清空历史 | `DELETE /api/history` | `handlers/prefs.go` |
| **未读列表** | `GET /unread` 显示还没翻开过的相册,带计数 badge + 随机未读 | `frontend/src/hooks/useUnreadAlbums.ts` + `routes/Unread.tsx` |
| **继续阅读 hero** | Home 顶部「N 本还没看完」区块,点卡直跳画廊(不经 Album 详情) | `routes/Home.tsx` `ContinueReadingHero` |
| **未读 hero** | Home 顶部「还有 N 本没看」区块 + 随机未读按钮 | `routes/Home.tsx` `UnreadHero` |
| 阅读进度 | `POST /api/progress` 幂等 upsert | `handlers/progress.go` |
| 单条进度 | `GET /api/progress?path=...` | `handlers/progress.go` |
| 进度自动上报 | 画廊每 1.5 秒 debounce 写一次 | `frontend/src/hooks/useReadingProgress.ts` |
| 偏好读取 | `GET /api/prefs` 返回完整对象 | `handlers/prefs.go` |
| 偏好更新 | `PATCH /api/prefs` 只覆盖传入字段 | `handlers/prefs.go` |

---

## 8. 主题与外观

| 功能 | 描述 | 位置 |
|------|------|------|
| 三态主题 | light / dark / system | `store/uiStore.ts` `theme` |
| 6 套强调色 | graphite / indigo / rose / forest / ochre / plum | `store/uiStore.ts` `accent` + `styles/` |
| CSS 变量驱动 | 主题切换 → `documentElement.setAttribute('data-theme')` → Tailwind `darkMode: ['class', '[data-theme="dark"]']` 触发变量重算，一次 reflow | `hooks/useTheme.ts` |
| 主题切换器 | 工具栏内联按钮 / 紧凑下拉（compact 模式含强调色选择） | `components/common/ThemeSwitcher.tsx` |
| 强调色持久化 | localStorage | `store/uiStore.ts` |
| 极简设计语言 | 米白 / 炭灰双底色，无衬线大标题，几何图标 | `styles/` + `components/common/Icon.tsx` |
| 玻璃态侧边栏 | `glass` 背景 + 细边框 | `components/layout/Sidebar.tsx` |

---

## 9. 快捷键与帮助

| 功能 | 描述 | 位置 |
|------|------|------|
| 单一来源 | `frontend/src/utils/shortcuts.ts` 的 `SHORTCUTS` 数组是所有 UI / 文档共用的真相 | `utils/shortcuts.ts` |
| 规范化按键 | `normalizeKey()` 统一 ctrl/alt/shift + 主键的命名空间 | `utils/shortcuts.ts` |
| 跨布局兼容 | `?` / `+` / `=` 字面字符忽略 shift 前缀（AZERTY / QWERTZ 也能命中） | `utils/shortcuts.ts` `normalizeKey` |
| 输入框失效 | input / textarea / contentEditable 获得焦点时全局 hook 自动跳过 | `hooks/useKeyboard.ts` |
| 可搜索帮助浮层 | `?` 唤起，输入即过滤；按 Esc 关闭 | `components/common/HelpOverlay.tsx` |
| 分组渲染 | global / gallery 两栏 | `HelpOverlay.tsx` |
| 画廊独立注册 | `Gallery.tsx` 内的快捷键不与全局冲突 | `routes/Gallery.tsx` |
| 完整列表 | 见 [`docs/SHORTCUTS.md`](./SHORTCUTS.md) | — |

---

## 10. 系统集成

| 功能 | 描述 | 位置 |
|------|------|------|
| 在系统资源管理器打开 | `GET /api/fs/open?path=...`（Windows 资源管理器 / macOS Finder / Linux xdg-open） | `handlers/fs.go` |
| allowOsOpen 开关 | 默认关闭，仅在受信环境开启 | `config.yaml` `allowOsOpen: false` |
| 单端口部署 | 后端用 `c.Static()` 托管 `staticDir`，API 与前端同源 | `cmd/server/main.go` `app.Static("/", cfg.StaticDir)` |
| nginx 部署 | 文档提供 nginx 反代配置样例 | `docs/ARCHITECTURE.md` 「部署」节 |
| ffmpeg 自动探测 | 后端启动时按 `bin/ffmpeg/<os>/<arch>/` 顺序找 ffmpeg / ffprobe | `cmd/server/main.go` `lookupFFmpeg` |
| ffmpeg 用户指定 | `config.yaml` 显式 `ffmpegPath` 覆盖探测 | `config.go` `FFmpegPath` |

---

## 11. 路径安全

| 功能 | 描述 | 位置 |
|------|------|------|
| 路径安全中间件 | 所有 `?path=` 请求经 `path_safety.Middleware` | `internal/middleware/path_safety.go` |
| 绝对路径校验 | `filepath.IsAbs(path)` 必须为真 | `path_safety.go` |
| 越权拦截 | `filepath.Rel(root, abs)` 结果不以 `..` 开头 | `path_safety.go` |
| 多根支持 | 路径必须落在任一 `mediaRoots` 之下（OR 关系） | `path_safety.go` |
| `smart:` 前缀 | 直查智能合集不做绝对路径校验 | `path_safety.go` `smart:` |
| 校验失败 | 一律 400，不暴露任何文件系统信息 | `path_safety.go` |
| 日志脱敏 | 错误日志不打印完整绝对路径 | 全局约定 |

---

## 12. 配置管理

| 功能 | 描述 | 位置 |
|------|------|------|
| 唯一配置源 | `backend/config.yaml`（相对 CWD）；不存在则用内置默认 | `internal/config/config.go` `LoadFile` |
| 启动 flag | `--config <yaml>` / `--static-dir <dir>`（仅这两个） | `cmd/server/main.go` `flag.Parse` |
| 内置默认 | 见 `config.Default()` | `config.go` |
| 网页改配置 | `GET /api/config` 读，`PUT /api/config` 写（部分字段） | `handlers/config.go` |
| 热生效字段 | `mediaRoots` / `cacheDir` / `thumbSize*` / `thumbCacheSize` / `cacheMaxAgeDays` / `allowOsOpen` / `ffmpegPath` / `skipHidden` / `excludePatterns` / `systemFiles` | `config/manager.go` |
| 需重启字段 | `host` / `port` / `staticDir` | `manager.go`（监听 / 静态托管在启动期绑定） |
| 响应提示 | `requiresRestart` 列出需重启的字段；`mediaRootsChanged` 提示是否清空扫描缓存 | `handlers/config.go` |
| 原子写 | tmp 文件 + `os.Rename` 原子替换 | `internal/config/manager.go` `Save` |
| 校验 | `Validate()` 在 LoadFile / Save 前各跑一次 | `config.go` `Validate` |
| bool 字段语义 | YAML 未设置视为 `false`；PATCH 未提供视为 unset | `config.go` `boolFieldSet` |

---

## 13. 持久化策略

| 数据 | 位置 | 写入策略 |
|------|------|---------|
| 缩略图 JPEG | `<cacheDir>/thumbs/<md5>.jpg` | 首次生成写盘，mtime 失效重生成，`/api/thumbs/cleanup` 清过期 |
| 视频 faststart 缓存 | `<cacheDir>/video-faststart/<md5>.mp4` | 首次 remux 写盘，源文件 mtime/size 变失效 |
| 视频转码缓存 | `<cacheDir>/video-transcode/<md5>.mp4` | 同上 + profile 变化失效 |
| 扫描结果 | 内存（`internal/services/scan_cache.go`） | 重启清空，`/api/scan/latest` 立即返 |
| 偏好 / 收藏 / 历史 | `<cacheDir>/prefs.json` | atomic tmp+rename |
| 前端 UI 状态（主题 / 侧边栏 / 视图） | 浏览器 localStorage | 跨设备不共享 |
| 画廊临时状态（页码 / 缩放） | 浏览器 sessionStorage | 标签页关闭清空 |

---

## 14. 命名历史（v1 → v2 → v3）

| 时期 | 项目名 | Go module | 缓存目录 | 画廊路由 |
|------|--------|-----------|----------|---------|
| v1（最初） | comic-reader / 漫画阅读器 | `tianlongxiang/comic-reader` | `.comic-reader/` | `/reader` |
| v2（2026 早期） | image-viewer / 图像浏览器 | `tianlongxiang/comic-reader` | `.image-viewer/` | `/viewer` |
| v3（当前） | local-gallery / 本地画廊 | `tianlongxiang/local-gallery` | `.local-gallery/` | `/gallery` |

语义升级路径：

| v1 漫画 | v2 图像 | v3 画廊 |
|---------|---------|---------|
| 漫画 / 本 / 卷 | 文件夹 | 文件夹 |
| 页 | 张 | 张 |
| 作者 / Author | 标签 / Tag | 标签 / Tag |
| 作者集合 | 智能合集 | 智能合集 |
| 阅读模式 | 显示模式 | 显示模式 |
| 单页 / 双页对开 | 单张 / 双张并排 | 单张 / 双张并排 |
| 漫画根 `comicRoot` | 媒体根 `mediaRoots[]` | 媒体根 `mediaRoots[]` |

旧字段 / 旧路径 / 旧路由（`/authors/*`）仍可识别，便于旧链接与缓存迁移。
