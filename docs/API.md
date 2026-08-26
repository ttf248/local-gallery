# HTTP API

> 当前接口契约只接受服务端生成的资源 ID。除本机配置管理接口外，响应、URL 和请求体均不得出现绝对文件系统路径。

## 通用约定

- 基础地址：`http://127.0.0.1:8080`。
- 资源校验错误使用 `{ "code": "...", "message": "..." }`；媒体不存在或 ID 已过期时重新扫描。现有业务接口的校验错误仍可能使用 `{ "error": "..." }`。
- `r_`、`a_`、`c_`、`f_` 分别表示根、相册、集合和文件资源 ID。
- 资源 ID 在根目录和相对路径不变时保持稳定，不包含可逆的绝对路径信息。
- SSE 响应使用 `text/event-stream`，客户端断开后服务端必须清理订阅。

## 健康与配置

### `GET /api/health`

返回版本、Go 版本、goroutine 数、脱敏根 ID 和能力位。`mediaRoots` 中只包含 `r_` ID。

### `GET /api/config` / `PUT /api/config`

读取或更新 `config.yaml`。这是唯一允许返回绝对配置路径的接口，只接受服务端回环地址请求；远程请求返回 `403 local_access_required`。

可更新字段：`mediaRoots`、`host`、`port`、`cacheDir`、`thumbSizeW`、`thumbSizeH`、`thumbCacheSize`、`cacheMaxAgeDays`、`ffmpegPath`、`allowOsOpen`、`staticDir`、`skipHidden`、`excludePatterns`、`systemFiles`。

`host`、`port`、`cacheDir`、`ffmpegPath` 和 `staticDir` 修改后需要重启；缩略图尺寸、LRU、保留天数和 `allowOsOpen` 可热更新，媒体根和扫描排除规则在下一次扫描生效。

## 图像库与扫描

### `POST /api/scans`

启动后台扫描，返回 `{ "scanId": "...", "reused": false }`。已有活动任务时不会重复扫描，返回相同 ID 和 `reused: true`。

### `GET /api/scans/:scanId/events`

订阅扫描事件。事件名为 `pending`、`running`、`complete`、`cancelled` 或 `error`；`currentPath` 仅包含根别名和相对路径。

### `GET /api/scans/:scanId`

扫描完成后返回 `{ "ok": true, "result": LibrarySnapshot }`；未完成返回 400。

### `DELETE /api/scans/:scanId`

取消扫描。取消信号会终止目录读取，取消后的任务不得写入图像库缓存。

### `GET /api/library`

返回最近一次扫描快照。相册、集合、封面和媒体文件均使用资源 ID。

### `DELETE /api/library`

清除内存和磁盘扫描缓存；不会立即发起新扫描。

## 相册与搜索

### `GET /api/albums/:albumId`

返回相册或集合详情。相册的 `imageFiles`、`videoFiles` 和 `coverImage` 均为 `f_` 文件 ID。

### `GET /api/tags/:tag`

返回标签聚合详情。

### `GET /api/search?q=<keyword>&limit=50`

搜索相册、集合和标签，结果中的 `path` 是相册/集合 ID；标签结果使用 `smart:<tag>` 作为前端导航标识。

### `PUT /api/albums/:albumId/cover?file=<fileId>`

设置自定义封面。文件必须属于相册且为受支持图片或视频。

### `DELETE /api/albums/:albumId/cover`

清除自定义封面并恢复扫描器默认封面。

## 媒体、缩略图与视频

### `GET /api/media/:fileId`

发送图片或视频。支持 ETag；视频支持 Range，并按需经过转码和 faststart 管线。

### `GET /api/thumbs/:fileId`

返回 JPEG 缩略图。视频尚无封面时返回 `404` 和 `code: video_cover_missing`。

### `POST /api/thumbs/:fileId/cover`

上传浏览器抽取的视频封面，body 为 JPEG/PNG 原始字节，最大 5 MiB。

### `GET /api/images/:fileId/info`

返回图片尺寸、格式、大小、修改时间和 checksum；`path` 为文件 ID，`dir` 为相对展示路径。

### `GET /api/videos/:fileId/info`

返回视频基础信息、ffprobe 元数据和转码状态，不返回绝对路径。

### 视频转码

- `GET /api/videos/:fileId/transcode/status`
- `GET /api/videos/:fileId/transcode/events`
- `POST /api/videos/:fileId/transcode/cancel`
- `GET /api/videos/transcode/cache/stats`
- `POST /api/videos/transcode/cache/clear`（仅本机）

## 收藏、历史与阅读进度

偏好文件只保存稳定资源 ID。旧版 `path` 字段和绝对路径记录在加载时丢弃，不再提供兼容解析。

- `GET /api/prefs`、`PATCH /api/prefs`：读取或修改界面偏好；历史和进度项使用 `albumId`。
- `GET /api/favorites`：返回 `{ "favorites": ["<resourceId>"] }`。
- `POST /api/favorites`、`DELETE /api/favorites`：body 为 `{ "resourceId": "a_... | c_... | smart:<tag>" }`。
- `POST /api/favorites/prune`：按当前资源目录移除已失效相册/集合 ID，不访问 ID 对应的文件路径；智能标签保留。资源目录尚未完成首次加载时返回 `409`，不会删除收藏。
- `GET /api/history`、`DELETE /api/history`。
- `POST /api/history`：body 为 `{ "albumId": "a_...", "name": "...", "imageCount": 42 }`。
- `GET /api/progress?albumId=<albumId>`。
- `POST /api/progress`：body 为 `{ "albumId": "a_...", "index": 12, "total": 30, "scroll": 0 }`。
- `DELETE /api/progress/item?albumId=<albumId>`；`DELETE /api/progress` 清空全部。
- `POST /api/progress/batch`：body 为 `{ "albumIds": ["a_...", "..."] }`，批量读取。
- `PUT /api/progress/batch`：body 为 `{ "entries": [{ "albumId": "a_...", "index": 30, "total": 30, "scroll": 0 }] }`，整批校验后一次原子落盘；单批最多 10000 条。

## 缓存与系统操作

- `GET /api/cache/stats`：返回脱敏缓存名称、占用和文件数。
- `GET /api/thumbs/stats`
- `POST /api/thumbs/cleanup`
- `POST /api/thumbs/clear`
- `POST /api/cache/clear?scope=thumbs|faststart|transcode|all`：统一清空入口，按 scope 删 thumbs / faststart / transcode 缓存中对应的一类；scope=all 等价三者都清。响应 `{ scope, thumbs?, faststart?, transcode?, totalDeleted, totalFreedBytes }`，未涉及的 scope 字段为 null。
- `POST /api/fs/open`：本机接口，body 为 `{ "id": "<resourceId>" }`。
- `GET /api/admin/fs/open?path=<configuredPath>&allowConfig=1`：设置页专用，仅允许打开已配置路径且只接受回环请求。
