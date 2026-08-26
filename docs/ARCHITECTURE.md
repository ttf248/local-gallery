# 系统架构

## 设计目标

Local Gallery 是单用户、本机优先的媒体浏览器。系统保持“单 Go 进程 + 本地文件 + 浏览器持久化”的边界，不引入数据库、消息队列、微服务或额外反向代理。

核心约束：

- 后端独占文件系统绝对路径，公共 API 与前端状态只使用稳定资源 ID。
- 开发期由 Vite 代理 `/api`；生产期由 Fiber 同端口托管静态资源和 API。
- 扫描、缩略图和视频处理允许后台执行，但必须支持取消、断连清理和有界并发。
- `config.yaml` 是唯一运行时配置源；命令行只允许选择配置文件。

## 分层与依赖

```text
React routes/components
        │
        ▼
API modules + TanStack Query + Zustand UI state
        │  resource IDs / JSON / SSE
        ▼
Fiber middleware → handlers → services → local files/cache
                         │          │
                         │          ├─ scanner / resource catalog
                         │          ├─ thumbnail / video pipeline
                         │          └─ scan cache
                         └──────────── prefs store
```

- `backend/cmd/server`：组合配置、服务、中间件、路由和进程生命周期，不承载业务规则。
- `backend/internal/middleware`：日志、恢复、回环限制、资源 ID 解析和路径安全。
- `backend/internal/handlers`：HTTP/SSE 契约、输入校验、状态码和公共 DTO。
- `backend/internal/services`：扫描、资源目录、缓存、缩略图、faststart、转码和元数据。
- `backend/internal/store`：偏好 JSON 的并发访问和原子落盘。
- `frontend/src/api`：唯一网络访问层；组件不手写端点。
- `frontend/src/store`：仅保存 UI 与会话状态；服务端数据由查询层管理。

依赖方向固定为入口 → handler → service/store → model。service 不依赖 Fiber，前端组件不接触文件系统路径。

## 资源标识与路径边界

扫描完成后，`ResourceCatalog` 从配置根目录和扫描树构建不可变索引：

| 前缀 | 资源     |
| ---- | -------- |
| `r_` | 媒体根   |
| `a_` | 相册     |
| `c_` | 集合     |
| `f_` | 媒体文件 |

ID 由根标识、资源类型和相对路径哈希生成；根目录与相对路径不变时 ID 稳定，且不能逆推出绝对路径。请求进入 `/api/media/:id` 等路由后，资源中间件先解析 ID，再由路径安全中间件确认目标仍位于当前 `mediaRoots` 内。未知、过期或越权 ID 不进入文件服务。

配置页是明确的管理例外：`/api/config` 和 `/api/admin/fs/open` 可处理配置路径，但只接受回环请求。日志只输出目录 basename、逻辑缓存名和能力状态。

## 扫描数据流

```text
POST /api/scans
  → StartOrReuse（全局最多一个活动任务）
  → Scanner.ScanWithContext（有界 worker pool）
  → per-subscriber SSE broadcast
  → complete: 重建 ResourceCatalog
  → 原子发布 ScanResultCache
  → GET /api/library
```

- 重复启动复用活动任务，不制造重复 I/O。
- 每个 SSE 连接有独立缓冲，慢客户端不能阻塞扫描或抢走其他客户端事件。
- `DELETE /api/scans/:id` 取消 context；取消结果不发布到库缓存。
- 终态任务短期保留供重连查询，随后自动回收。
- SSE 中的 `currentPath` 只使用根别名和相对路径。

扫描器保留目录层级：纯媒体目录形成相册；同时包含媒体和子目录时形成集合，并以“散图”相册表示当前层媒体。标签从文件夹名提取并生成智能合集。

## 媒体管线

图片通过 `/api/media/:fileId` 发送，使用 mtime + size 生成 ETag。缩略图采用内存 LRU 和磁盘缓存，源文件变化时失效。

视频发送顺序：

```text
浏览器请求
  → 已缓存的兼容转码
  → MP4 faststart remux
  → 原始视频
```

ffprobe 提供元数据；不兼容编码按需转为 H.264 + AAC；MP4 的 moov atom 不在前部时仅 remux。转码采用 singleflight 和全局并发限制，SSE 订阅断开时释放订阅资源。ffmpeg 不可用时能力降级而不阻断图片和原生兼容视频。

## 配置与持久化

- 配置：`backend/config.yaml`，`mediaRoots` 是唯一媒体根字段。
- 默认缓存：进程 CWD 下 `.local-gallery/`。
- 扫描缓存：版本化的 `scan_cache.json`，只保存根 ID 与相对引用；启动时用当前根还原内部路径，旧格式或根集合变化时直接失效。
- 偏好：`web_settings.json`，通过临时文件 + rename 原子落盘。
- 缩略图、faststart、转码：按内容派生键写入独立子目录。

`host`、`port`、`staticDir`、`cacheDir` 和 `ffmpegPath` 属于启动期资源，修改后重启。扫描根、扫描排除规则、缩略图尺寸/LRU/保留天数和 `allowOsOpen` 可热更新。

进程收到 `SIGINT` / `SIGTERM` 后先停止接收新连接，同时取消活动扫描和视频转码；退出前强制刷新扫描快照。HTTP 连接最多等待 5 秒，后台任务与缓存清理共用 10 秒退出窗口。

## 前端状态边界

- TanStack Query 管理 library、album、metadata、prefs 等服务端状态和失效。
- Zustand 管理主题、筛选、画廊模式、键盘交互等客户端状态。
- URL 保存可分享的导航状态，只包含资源 ID 或 `smart:<tag>`。
- Home、Album、Gallery、Settings 按路由懒加载；大页面按领域组件和 hooks 拆分。

前端不得把服务端快照再复制成第二份长期 store。写操作成功后以查询失效或精确的乐观更新同步，避免双数据源漂移。

## 安全与生命周期

- 默认监听 `127.0.0.1`；管理端点额外校验回环地址。
- 所有路径拼接使用 `path/filepath`，解析后再次校验根目录边界。
- 公共错误返回稳定 code/message，不回传底层含路径错误。
- 后台任务、定时器和 SSE 订阅均有明确 owner、取消函数和回收时点。
- 扫描快照对 Get/Set 都做深拷贝；并发落盘按版本确认，清空操作与写盘互斥，避免旧快照复活或覆盖新结果。

## 测试边界

- Go 单元测试覆盖 service、middleware 和 handler 行为。
- `tests/integration` 使用真实 Fiber 路由验证扫描、资源 ID、缩略图与 SSE 主链路。
- Vitest + Testing Library 覆盖前端查询、store、hook 和组件行为。
- Playwright 从临时媒体根启动完整应用，验证首屏扫描与资源 ID 媒体访问。

标准验证命令见根 README。性能优化扫描或缩略图主路径时，另记录样本规模、吞吐、p95 和内存前后对照。
