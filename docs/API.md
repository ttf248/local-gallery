# API 文档

图像浏览器后端的 HTTP 接口手册。所有端点位于 `/api` 前缀下。

## 通用约定

| 项 | 值 |
|----|----|
| 基础地址 | `http://<host>:<port>`（默认 `http://localhost:8080`） |
| 内容类型 | `application/json`（除缩略图/原图外） |
| 路径参数 | URL 中的 `?path=<abs>` 必须为绝对路径，且必须位于配置的 `mediaRoot` 之下；`?path=smart:<tag>` 用于按标签查询智能合集 |
| 字符编码 | UTF-8；路径中的中文/空格需 URL-encode |
| 错误响应 | `{ "error": "<可读消息>" }`，状态码 4xx/5xx |
| Cache-Control | 缩略图 30 天；原图 1 天 |

> 兼容说明：路径根字段新名 `mediaRoot`，旧名 `comicRoot` 仍可识别；`/api/albums` 与 `/api/folders` 是同一接口的两个名称。

---

## 健康检查

### `GET /api/health`

```json
{
  "status": "ok",
  "mediaRoot": "E:\\图像",
  "comicRoot": "E:\\图像",
  "version": "0.1.0",
  "goVersion": "go1.24.x",
  "goroutines": 12
}
```

`mediaRoot` 为当前生效根（优先用新名）；`comicRoot` 同步暴露以兼容旧客户端。

---

## 扫描

### `POST /api/scan`（同步）

阻塞扫描整个图像根目录；适合小型库（<1k 个文件夹）。

```json
{
  "ok": true,
  "result": {
    "root": "E:\\图像",
    "albums": [
      { "path": "...", "name": "卷1", "imageCount": 50, "author": "标签A", "coverImage": "..." }
    ],
    "collections": [],
    "smartCollections": [
      { "tag": "标签A", "author": "标签A", "albumCount": 5, "coverImage": "..." }
    ],
    "albumCount": 50,
    "duration": 1234
  }
}
```

`author` 字段为兼容保留，内容与 `tag`（第一个标签）相同。

### `POST /api/scan/start`（异步）

立即返回 `scanId`，扫描在后台进行。

```json
{ "scanId": "5f631a76-..." }
```

### `GET /api/scan/:id/events`（SSE）

建立长连接，按事件推送进度。事件格式：

```
event: running
data: {"scanId":"...","progress":42,"albumsFound":15,...}

event: complete
data: {"scanId":"...","progress":100,"albumsFound":50,...}

event: cancelled
data: {"scanId":"...",...}

event: error
data: {"scanId":"...","error":"permission denied",...}
```

### `GET /api/scan/:id/result`

获取已完成扫描的最终结果（结构同 `/api/scan`）。

### `GET /api/scan/latest`

返回最近一次扫描的缓存结果（无需重新扫描）。`/api/scan/latest` 即前端首页启动时拉取的入口。

### `DELETE /api/scan/:id`

取消正在进行的扫描。

---

## 文件夹 / 集合 / 智能合集

### `GET /api/folders?path=<abs>`（新名；`/api/albums` 兼容）

按路径返回详细信息：

- 普通文件夹（Album）：`{ kind: "album", data: { path, name, imageFiles:[…], imageCount, tags:[…], author, … } }`
- 集合（Collection）：`{ kind: "collection", data: { path, name, albums:[…], albumCount } }`
- 智能合集：`?path=smart:<tag>` → `{ kind: "smart", data: { tag, author, albums:[…], albumCount, coverImage } }`

`imageFiles` 在前端中可同时以 `files` 字段名读取（双键别名，向后兼容）。

### `GET /api/tags?path=smart:<tag>`

按标签名直接查询智能合集。等价于 `/api/folders?path=smart:<tag>`。

### `GET /api/search?q=<keyword>&limit=<n>`

按关键字模糊搜索文件夹/合集/智能合集（不区分大小写，匹配 name/author）。`limit` 默认 50，最大 500。

```json
{
  "ok": true,
  "results": [
    { "kind": "album", "path": "…", "name": "卷1", "count": 50, "coverImage": "…" },
    { "kind": "smartCollection", "path": "smart:标签A", "name": "标签A", "count": 5, "coverImage": "…" }
  ],
  "count": 2
}
```

---

## 缩略图与原图

### `GET /api/thumbs?path=<abs>`

返回 PNG（默认 320×350，保持比例）。支持服务端 LRU + 磁盘缓存。

### `GET /api/thumbs/stats`

```json
{
  "cacheSize": 123,
  "hitCount": 4567,
  "missCount": 890,
  "diskBytes": 12345678
}
```

### `POST /api/thumbs/cleanup`

清理超过 `cacheMaxAgeDays` 的磁盘缓存文件。

```json
{ "deleted": 12 }
```

### `GET /api/images?path=<abs>`

返回原始图片（支持 `Range` 请求，用于分段加载大图）。HEIC/HEIF 文件以 `image/heic` MIME 直出；前端浏览器需支持原生 HEIC 解码（Safari 16+，Chrome 当前不支持，会回退到下载）。

### `GET /api/images/info?path=<abs>`

```json
{
  "path": "...",
  "name": "image1.png",
  "dir": "...",
  "size": 123456,
  "mtime": "2026-08-01T12:34:56Z",
  "width": 1200,
  "height": 1800,
  "format": "png",
  "checksum": "ab12cd34ef567890"
}
```

---

## 阅读进度

### `GET /api/progress?path=<abs>`

```json
{ "path": "…", "index": 12, "total": 50, "scroll": 0, "updated": "2026-08-15T12:34:56Z" }
```

无记录时返回 404。

### `POST /api/progress`

```json
{ "path": "…", "index": 12, "total": 50, "scroll": 0 }
```

幂等 upsert。

---

## 偏好与历史

### `GET /api/prefs`

```json
{
  "favorites": ["/path1", "/path2"],
  "history": [{ "path": "/x", "name": "X", "imageCount": 5, "openedAt": "..." }],
  "maxRecent": 10,
  "autoSwitchAlbum": true,
  "showSwitchNotif": true,
  "theme": "system",
  "sidebarCollapsed": false
}
```

### `PATCH /api/prefs`

只覆盖传入的字段。Body 示例：
```json
{ "theme": "dark", "autoSwitchAlbum": false }
```

---

## 收藏

### `GET /api/favorites`

```json
{ "favorites": ["/path1", "/path2"] }
```

### `POST /api/favorites`

```json
{ "path": "/path/to/album" }
```

幂等添加。返回最新的收藏列表。`path` 也支持 `smart:<tag>` 形式。

### `DELETE /api/favorites`

```json
{ "path": "/path/to/album" }
```

幂等移除。

### `POST /api/favorites/prune`

移除磁盘上已不存在的收藏。返回 `{ "removed": ["..."] }`。

---

## 最近访问

### `GET /api/history`

### `POST /api/history`

```json
{ "path": "/x", "name": "X", "imageCount": 5 }
```

按 LRU 去重，最多 10 条（受 `maxRecent` 配置）。

### `DELETE /api/history`

清空历史。

---

## 系统集成

### `GET /api/fs/open?path=<abs>`

在系统文件管理器中打开指定路径（Windows 资源管理器/macOS Finder/Linux xdg-open）。

- 仅当配置 `allowOsOpen=true` 时启用（默认关闭）。
- 路径必须在 `mediaRoot` 内（防越权）。
- 403：`allowOsOpen` 禁用；400：路径越权。

---

## 错误码

| 码 | 含义 |
|----|------|
| 400 | 参数缺失/路径越权 |
| 403 | 功能未启用（`allowOsOpen`） |
| 404 | 文件不存在 / 扫描结果不存在 / 智能合集不存在 |
| 415 | 不支持的图片格式（仅缩略图生成） |
| 500 | 服务端错误 |

---

## 配置项（服务端）

通过 `backend/config.yaml` 配置（默认相对后端 CWD 查找）。完整示例见 [`backend/config.example.yaml`](../backend/config.example.yaml)。

```yaml
# 图像根目录（必填，必须是已存在的目录）
# 新名；旧名 comicRoot 仍可识别。
mediaRoot: "E:\\图像"

# 监听地址与端口
host: "0.0.0.0"
port: 8080

# 缩略图缓存目录（相对 CWD；未配置则在 CWD 下创建 .image-viewer/）
cacheDir: ".image-viewer"

# 缩略图尺寸
thumbSizeW: 320
thumbSizeH: 350

# 缩略图 LRU 内存缓存项数
thumbCacheSize: 500

# 缓存保留天数
cacheMaxAgeDays: 30

# 是否允许 /api/fs/open 在服务端打开文件管理器
allowOsOpen: false

# 前端构建产物目录（不存在则跳过静态托管）
staticDir: "dist"
```

启动参数仅保留 `--config <yaml-path>`（指定非默认位置的配置文件）和 `--static-dir <dir>`（覆盖 `staticDir` 字段，便于在不同环境切换前端产物路径）。**不再支持环境变量或 --media-root / --host / --port 等覆盖。**

优先级：`YAML 显式值` > `内置默认值`。

### 网页端运行时配置

后端在 `config.NewManager` 中持有当前配置，handler 通过 `/api/config` 读写；改动通过 PUT 写回 YAML（原子 tmp+rename）。

| 字段 | GET/PUT 行为 |
|------|-------------|
| `mediaRoot` | 热生效：路径安全中间件和扫描器改读新根；旧扫描结果会清空，调用方应触发重新扫描 |
| `cacheDir` / `thumbSizeW` / `thumbSizeH` / `thumbCacheSize` / `cacheMaxAgeDays` | 热生效：缩略图服务立即使用新参数 |
| `allowOsOpen` | 热生效：`/api/fs/open` 立即按新值放行 / 拦截 |
| `host` / `port` / `staticDir` | **需重启后端**（监听地址 / 端口 / 静态托管都绑定在启动期）|

PUT 响应里 `requiresRestart` 列出需要重启的字段；`mediaRootChanged` 指示是否清空了扫描缓存。

### `GET /api/config`

```json
{
  "mediaRoot": "E:\\图像",
  "host": "0.0.0.0",
  "port": 8080,
  "cacheDir": ".image-viewer",
  "thumbSizeW": 320,
  "thumbSizeH": 350,
  "thumbCacheSize": 500,
  "cacheMaxAgeDays": 30,
  "allowOsOpen": false,
  "staticDir": "dist",
  "configPath": "C:\\path\\to\\config.yaml"
}
```

### `PUT /api/config`

请求体为部分 PATCH，未提供的字段不修改；bool 字段（如 `allowOsOpen`）必须显式传值以区分 unset / explicit false。

```json
{ "thumbSizeW": 400, "allowOsOpen": true }
```

成功响应：

```json
{
  "ok": true,
  "config": { "...": "更新后的完整配置" },
  "requiresRestart": [],
  "mediaRootChanged": false
}
```

校验失败时返回 400：`{ "error": "validate: invalid port 0" }`。
