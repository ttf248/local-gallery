# API 文档

漫画阅读器后端的 HTTP 接口手册。所有端点位于 `/api` 前缀下。

## 通用约定

| 项 | 值 |
|----|----|
| 基础地址 | `http://<host>:<port>`（默认 `http://localhost:8080`） |
| 内容类型 | `application/json`（除缩略图/原图外） |
| 路径参数 | URL 中的 `?path=<abs>` 必须为绝对路径，且必须位于配置的 `comicRoot` 之下 |
| 字符编码 | UTF-8；路径中的中文/空格需 URL-encode |
| 错误响应 | `{ "error": "<可读消息>" }`，状态码 4xx/5xx |
| Cache-Control | 缩略图 30 天；原图 1 天 |

---

## 健康检查

### `GET /api/health`

```json
{
  "status": "ok",
  "comicRoot": "E:\\漫画",
  "version": "0.1.0",
  "goVersion": "go1.22.x",
  "goroutines": 12
}
```

---

## 扫描

### `POST /api/scan`（同步，T4）

阻塞扫描整个漫画根目录；适合小型库（<1k 卷）。

```json
{
  "ok": true,
  "result": {
    "root": "E:\\漫画",
    "albums": [
      { "path": "...", "name": "vol1", "imageCount": 50, "author": "作者A", "coverImage": "..." }
    ],
    "collections": [],
    "smartCollections": [
      { "author": "作者A", "albumCount": 5, "coverImage": "..." }
    ],
    "albumCount": 50,
    "duration": 1234
  }
}
```

### `POST /api/scan/start`（异步，T6）

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

### `DELETE /api/scan/:id`

取消正在进行的扫描。

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

返回原始图片（支持 `Range` 请求，用于分段加载大图）。

### `GET /api/images/info?path=<abs>`

```json
{
  "path": "...",
  "name": "page1.png",
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
{ "path": "/comic/volume1" }
```
幂等添加。返回最新的收藏列表。

### `DELETE /api/favorites`

```json
{ "path": "/comic/volume1" }
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
- 路径必须在 `comicRoot` 内（防越权）。
- 403：`allowOsOpen` 禁用；400：路径越权。

---

## 错误码

| 码 | 含义 |
|----|------|
| 400 | 参数缺失/路径越权 |
| 403 | 功能未启用（`allowOsOpen`） |
| 404 | 文件不存在 |
| 415 | 不支持的图片格式 |
| 500 | 服务端错误 |

---

## 配置项（服务端）

通过 `backend/config.yaml` 配置（默认相对后端 CWD 查找）。完整示例见 [`backend/config.example.yaml`](../backend/config.example.yaml)。

```yaml
# 漫画根目录（必填，必须是已存在的目录）
comicRoot: "E:\\漫画"

# 监听地址与端口
host: "0.0.0.0"
port: 8080

# 缩略图缓存目录（相对 CWD；未配置则在 CWD 下创建 .comic-reader/）
cacheDir: ".comic-reader"

# 缩略图尺寸
thumbSizeW: 320
thumbSizeH: 350

# 缓存保留天数
cacheMaxAgeDays: 30

# 是否允许 /api/fs/open 在服务端打开文件管理器
allowOsOpen: false

# 前端构建产物目录（不存在则跳过静态托管）
staticDir: "dist"
```

启动参数仅保留 `--config <yaml-path>`（指定非默认位置的配置文件）和 `--static-dir <dir>`（覆盖 `staticDir` 字段，便于在不同环境切换前端产物路径）。**不再支持环境变量或 --comic-root / --host / --port 等覆盖。**

优先级：`YAML 显式值` > `内置默认值`。