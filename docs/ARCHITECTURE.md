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
                                  │  文件系统 (漫画根目录)    │
                                  │  E:\漫画 → ./comics       │
                                  └──────────────────────────┘
```

## 后端模块（Go）

```
backend/
├── cmd/server/main.go          # 入口：YAML 加载 + 服务装配
├── internal/
│   ├── config/                 # YAML 配置加载 + 校验
│   ├── models/                 # 领域模型（Album、Collection、SmartCollection、Prefs）
│   ├── services/               # 业务逻辑
│   │   ├── scanner.go          # 文件遍历 + goroutine worker pool
│   │   ├── smart_group.go      # [作者] 智能分组
│   │   ├── thumbnail.go        # LRU + 磁盘缓存 + Lanczos
│   │   ├── scan_runner.go      # 异步扫描 + SSE 推送
│   │   └── image_info.go       # 尺寸/格式/checksum
│   ├── store/                  # JSON 偏好持久化（原子写）
│   ├── handlers/               # Fiber 路由处理
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
│   └── useAlbumActions.ts      # 右键菜单动作
├── store/                      # zustand
│   ├── uiStore.ts              # 侧边栏/主题（localStorage 持久化）
│   └── viewerStore.ts          # 查看器临时状态（sessionStorage）
├── routes/                     # 页面
├── components/
│   ├── layout/                 # AppShell / Sidebar / Toolbar / StatusBar / Breadcrumb
│   ├── album/                  # AlbumGrid / AlbumCard / ContextMenu / ScanProgress
│   ├── viewer/                 # ImageViewer / ViewerToolbar / ImageInfoPanel
│   └── common/                 # EmptyState / HelpOverlay / PropertiesDialog / ThemeSwitcher
└── utils/                      # 工具
    ├── shortcuts.ts            # 快捷键清单（单一来源）
    ├── storage.ts              # sessionStorage 持久化
    └── format.ts               # 字节大小格式化
```

## 关键流程

### 1. 启动

```
main()
  ├─ flag.Parse()                      # 仅 --config / --static-dir
  ├─ config.LoadFile(config.yaml)      # YAML 覆盖默认
  ├─ cfg.Validate()                    # ComicRoot 必须存在且为目录
  ├─ fiber.New() + Use(logger/recover/path_safety)
  ├─ 注册 /api/* 路由
  └─ app.Listen(cfg.Addr())
```

### 2. 扫描（异步）

```
POST /api/scan/start
  → runner.Start(opts)
    → uuid.New() 生成 scanId
    → goroutine: scanner.ScanWithHook(opts, hook)
      → filepath.WalkDir → worker pool → 发现相册 → 推送 ProgressEvent
      → smart_group.GroupByAuthor()
      → 写 final ProgressEvent(ScanStatusComplete)
  ← { scanId }

GET /api/scan/:id/events (SSE)
  → runner.Get(id) → state.Events (chan)
  → SetBodyStreamWriter: for ev := range state.Events { fmt.Fprintf(w, "event: ...") }
```

### 3. 查看图片

```
GET /api/thumbs?path=<abs>
  → middleware.SafePath (path_safety 校验)
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

## 部署

```bash
# 后端
cd backend
cp config.example.yaml config.yaml
# 编辑 config.yaml，设置 comicRoot: "/data/comics"
go build -o comic-server ./cmd/server
./comic-server

# 前端
cd frontend
npm run build
# 将 dist/ 静态部署到 Nginx/Caddy，并与 comic-server 反向代理在同一域
```

生产配置示例：

```nginx
location / {
  root /var/www/comic-reader;
  try_files $uri /index.html;
}
location /api/ {
  proxy_pass http://127.0.0.1:8080;
  proxy_buffering off;     # SSE 必需
}
```