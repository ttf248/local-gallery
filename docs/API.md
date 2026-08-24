# API · HTTP 接口手册

> 本地画廊（Local Gallery）后端的 HTTP 接口。基础前缀 `/api`，JSON 为主，缩略图 / 原图 / 视频流走二进制。

---

## 0. 通用约定

| 项 | 值 |
|----|----|
| 基础地址 | `http://<host>:<port>`（默认 `:8080`） |
| 内容类型 | `application/json`，缩略图 `image/jpeg`，原图按扩展名 |
| 路径参数 | `?path=<abs>` 必须是绝对路径且落在任一 `mediaRoots` 下；`?path=smart:<tag>` 查智能合集 |
| 字符编码 | UTF-8；中文 / 空格需 URL-encode |
| 错误响应 | `{ "error": "<可读消息>" }`，状态码 4xx / 5xx |
| Cache-Control | 缩略图 30 天；原图 1 天；视频 1 天 |
| Range / ETag | 原图 / 视频流都支持 |

> **兼容说明**：`mediaRoots`（数组）是权威字段，旧名 `mediaRoot` / `comicRoot`（单数）仍可识别为单元素数组。`/api/albums` ≡ `/api/folders`。

---

## 1. 端点索引

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 + 运行时信息 |
| `/api/scan` | POST | 同步扫描（小库） |
| `/api/scan/start` | POST | 异步扫描，返 `scanId` |
| `/api/scan/:id/events` | GET (SSE) | 扫描进度 |
| `/api/scan/:id/result` | GET | 已完成扫描的结果 |
| `/api/scan/latest` | GET | 最近一次扫描结果缓存 |
| `/api/scan/:id` | DELETE | 取消扫描 |
| `/api/folders` (`/api/albums`) | GET | 按路径取详情 |
| `/api/tags` | GET | `?path=smart:<tag>` 直查 |
| `/api/search` | GET | 模糊搜索 |
| `/api/thumbs` | GET | 缩略图 JPEG |
| `/api/thumbs/cover` | POST | 浏览器抽帧上传 |
| `/api/thumbs/stats` | GET | 缩略图缓存统计 |
| `/api/thumbs/cleanup` | POST | 清理过期 |
| `/api/images` | GET | 原图（Range / ETag / HEIC） |
| `/api/images/info` | GET | 原图元数据 |
| `/api/videos` | GET | 视频流（Range / ETag / 转码决策） |
| `/api/videos/info` | GET | 视频元数据 + 转码状态 |
| `/api/videos/transcode/status` | GET | 单个视频转码状态 |
| `/api/videos/transcode/events` | GET (SSE) | 转码进度 |
| `/api/videos/transcode/cancel` | POST | 取消转码 |
| `/api/videos/transcode/cache/stats` | GET | 转码缓存占用 |
| `/api/videos/transcode/cache/clear` | POST | 清转码缓存 |
| `/api/progress` | GET / POST | 阅读进度 upsert |
| `/api/prefs` | GET / PATCH | 完整偏好 |
| `/api/favorites` | GET / POST / DELETE | 收藏（幂等） |
| `/api/favorites/prune` | POST | 移除失效收藏 |
| `/api/history` | GET / POST / DELETE | 最近访问 |
| `/api/fs/open` | GET | 系统资源管理器 |
| `/api/config` | GET / PUT | 服务端配置 |

---

## 2. 健康检查

### `GET /api/health`

```json
{
  "status": "ok",
  "mediaRoots": ["E:\\图像", "F:\\漫画"],
  "mediaRoot": "E:\\图像",
  "comicRoot": "E:\\图像",
  "version": "0.1.0",
  "goVersion": "go1.24.x",
  "goroutines": 12
}
```

`mediaRoots` 是权威数组；`mediaRoot` / `comicRoot` 是首元素别名。

---

## 3. 扫描

### `POST /api/scan`（同步）

阻塞扫描完整结果。**只适合小库**（< 1k 个 album）。

```json
{
  "ok": true,
  "result": {
    "root": "E:\\图像",
    "albums": [
      {
        "path": "E:\\图像\\[作者A]\\卷01",
        "name": "卷01",
        "imageCount": 50,
        "videoCount": 2,
        "coverImage": "E:\\图像\\[作者A]\\卷01\\01.jpg",
        "coverKind": "image",
        "tags": ["作者A"]
      }
    ],
    "collections": [],
    "smartCollections": [
      { "tag": "作者A", "author": "作者A", "albumCount": 5 }
    ],
    "albumCount": 50,
    "duration": 1234
  }
}
```

### `POST /api/scan/start`（异步）

```json
{ "scanId": "5f631a76-..." }
```

### `GET /api/scan/:id/events` (SSE)

```
event: running
data: {"scanId":"...","progress":42,"albumsFound":15}

event: complete
data: {"scanId":"...","progress":100,"albumsFound":50}

event: cancelled
data: {"scanId":"..."}

event: error
data: {"scanId":"...","error":"permission denied"}
```

### `GET /api/scan/:id/result`

返回结构同 `/api/scan`。`/api/scan/:id` 必须存在。

### `GET /api/scan/latest`

最近一次扫描的内存缓存（无需重扫）。首页启动时拉这个。

### `DELETE /api/scan/:id`

取消正在跑的扫描。

---

## 4. 文件夹 / 集合 / 智能合集

### `GET /api/folders?path=<abs>` (`/api/albums` 兼容)

按路径返回详情，类型由 `kind` 字段区分：

**Album**（普通文件夹）：
```json
{
  "kind": "album",
  "data": {
    "path": "E:\\图像\\卷01",
    "name": "卷01",
    "imageFiles": ["E:\\...\\01.jpg", "..."],
    "videoFiles": ["E:\\...\\01.mp4"],
    "imageCount": 50,
    "videoCount": 1,
    "coverImage": "E:\\...\\01.jpg",
    "coverKind": "image",
    "tags": ["作者A", "分类B"],
    "author": "作者A"
  }
}
```

> `imageFiles` 也有 `files` 字段别名（向后兼容）。`videoFiles` 独立。

**Collection**（上层目录）：
```json
{
  "kind": "collection",
  "data": {
    "path": "E:\\图像\\[作者A]",
    "name": "[作者A]",
    "albums": [...],
    "albumCount": 5
  }
}
```

**SmartCollection**（按标签）：
```json
{
  "kind": "smart",
  "data": {
    "tag": "作者A",
    "author": "作者A",
    "albums": [...],
    "albumCount": 5,
    "coverImage": "E:\\...\\01.jpg"
  }
}
```

### `GET /api/tags?path=smart:<tag>`

`/api/folders?path=smart:<tag>` 的同义路由。

### `GET /api/search?q=<kw>&limit=<n>`

模糊搜索 name / tag / author，`limit` 默认 50、最大 500。

```json
{
  "ok": true,
  "results": [
    { "kind": "album", "path": "...", "name": "卷1", "count": 50, "coverImage": "..." },
    { "kind": "smartCollection", "path": "smart:作者A", "name": "作者A", "count": 5 }
  ],
  "count": 2
}
```

---

## 5. 缩略图

### `GET /api/thumbs?path=<abs>`

JPEG（默认 320×350，比例保持，黑边 letterbox）。支持 LRU + 磁盘 + ETag。

**视频路径**（`.mp4`/`.webm`/`.mov`/`.mkv`/`.avi`/`.m4v`）：

| 场景 | 行为 |
|------|------|
| 封面已缓存 | 直接返回 JPEG |
| 封面未生成 + ffmpeg 可用 | 服务端 ffmpeg seek 抽帧，缓存后返回 |
| 封面未生成 + ffmpeg 不可用 | 404 `{ code: "video_cover_missing" }`，前端触发浏览器抽帧 |

**性能**：服务端 ffmpeg 抽帧对 380MB / 176s / 1280×720 H.264 约 **339ms**；缓存命中 < 1ms。浏览器 fallback 需下载整段（30+ 秒，400MB+ 内存）。

### `POST /api/thumbs/cover?path=<abs_video>`

接收浏览器抽帧的字节（`canvas.toBlob('image/jpeg', 0.85)`），写入缓存。

| 状态码 | 含义 |
|--------|------|
| 200 | `{ "ok": true, "bytes": N }` |
| 400 | path 缺失 / 非视频 |
| 404 | 视频文件不存在 |
| 413 | > 5 MB |
| 415 | 字节不是合法图片 |

### `GET /api/thumbs/stats`

```json
{ "cacheSize": 123, "hitCount": 4567, "missCount": 890, "diskBytes": 12345678 }
```

### `POST /api/thumbs/cleanup`

清掉超过 `cacheMaxAgeDays` 的磁盘缓存。

```json
{ "deleted": 12 }
```

---

## 6. 原图

### `GET /api/images?path=<abs>`

返回原始字节。**支持 Range**（`c.SendFile(path, true)`），HEIC/HEIF 以 `image/heic` 直出（Safari 16+ 支持，Chrome 会回退到下载）。

### `GET /api/images/info?path=<abs>`

```json
{
  "path": "E:\\...\\01.png",
  "name": "01.png",
  "dir": "E:\\...",
  "size": 123456,
  "mtime": "2026-08-01T12:34:56Z",
  "width": 1200,
  "height": 1800,
  "format": "png",
  "checksum": "ab12cd34ef567890"
}
```

---

## 7. 视频

### `GET /api/videos?path=<abs>`

**Range / ETag / 4 层 fallback**：

```
请求 → Transcode → Faststart → 原文件
```

| 响应头 | 值 |
|--------|----|
| `Accept-Ranges` | `bytes` |
| `Cache-Control` | `public, max-age=86400` |
| `ETag` | `"<mtime_ns>-<size>"`（基于实际发送文件的元数据） |

ETag 命中 → `304 Not Modified`，浏览器复用本地 Range 段。

非视频扩展名 → 415；不存在 → 404。

### `GET /api/videos/info?path=<abs>`

```json
{
  "path": "E:\\...\\video.mp4",
  "name": "video.mp4",
  "dir": "E:\\...",
  "size": 12345678,
  "mtime": "2026-08-20T12:34:56Z",
  "format": ".mp4",
  "duration": 176.704,
  "width": 1280,
  "height": 720,
  "codec": "h264",
  "container": "mov,mp4,m4a,3gp,3g2,mj2",
  "bitRate": 18103993
}
```

`duration` / `width` / `height` / `codec` / `container` / `bitRate` 仅在 ffprobe 可用时填；解析失败时附 `probeError`（不抛 5xx，前端用 `<video>` 兜底）。

### `GET /api/videos/transcode/status?path=<abs>`

```json
{ "status": "running", "progress": 0.42, "etaSec": 180, "error": "" }
```

| status | 含义 |
|--------|------|
| `not_needed` | 浏览器支持该编码，跳过转码 |
| `cached` | 已转码，命中缓存 |
| `queued` | 等待全局并发名额 |
| `running` | 转码中 |
| `failed` | 转码失败（详细原因在 server log） |
| `unavailable` | ffmpeg 不可用 |

### `GET /api/videos/transcode/events?path=<abs>` (SSE)

```
event: progress
data: {"status":"running","progress":0.42,"etaSec":180}

event: done
data: {"status":"cached","progress":1.0}
```

30 秒心跳（`: ping`）防代理超时；断线后服务端 cancel 订阅。

### `POST /api/videos/transcode/cancel?path=<abs>`

```json
{ "ok": true, "status": "cancelled" }
```

不跑也返 200（status 反映取消后状态）。

### `GET /api/videos/transcode/cache/stats`

```json
{ "path": "<cacheDir>/video-transcode", "totalBytes": 1234567890, "fileCount": 23 }
```

### `POST /api/videos/transcode/cache/clear?maxBytes=&maxAgeDays=`

```json
{ "ok": true, "deleted": 12, "freedBytes": 1234567 }
```

任一 query 留空 = 该维度不限。

---

## 8. 阅读进度

### `GET /api/progress?path=<abs>`

```json
{ "path": "...", "index": 12, "total": 50, "scroll": 0, "updated": "2026-08-15T12:34:56Z" }
```

无记录返 404。

### `POST /api/progress`

```json
{ "path": "...", "index": 12, "total": 50, "scroll": 0 }
```

幂等 upsert。前端 1.5s debounce 自动写。

---

## 9. 偏好与历史

### `GET /api/prefs`

```json
{
  "favorites": ["/path1"],
  "history": [{ "path": "/x", "name": "X", "imageCount": 5, "openedAt": "..." }],
  "maxRecent": 10,
  "autoSwitchAlbum": true,
  "showSwitchNotif": true,
  "theme": "system",
  "sidebarCollapsed": false
}
```

### `PATCH /api/prefs`

只覆盖传入字段。body 示例：`{ "theme": "dark", "autoSwitchAlbum": false }`

---

## 10. 收藏

### `POST /api/favorites`

```json
{ "path": "/path/to/album" }   // 也支持 smart:<tag>
```

幂等添加，返最新收藏列表。

### `DELETE /api/favorites`

```json
{ "path": "/path/to/album" }
```

幂等移除。

### `POST /api/favorites/prune`

移除磁盘上已不存在的收藏：

```json
{ "removed": ["..."] }
```

---

## 11. 最近访问

### `GET /api/history`

### `POST /api/history`

```json
{ "path": "/x", "name": "X", "imageCount": 5 }
```

LRU 去重，最多 `maxRecent` 条（默认 10）。

### `DELETE /api/history`

清空。

---

## 12. 系统集成

### `GET /api/fs/open?path=<abs>`

在系统资源管理器打开（Windows 资源管理器 / macOS Finder / Linux `xdg-open`）。

- 仅当 `allowOsOpen=true`（默认 `false`）
- 路径必须在 `mediaRoots` 之下
- 403：未启用；400：越权

---

## 13. 错误码

| 码 | 含义 |
|----|------|
| 400 | 参数缺失 / 路径越权 |
| 403 | 功能未启用（`allowOsOpen`） |
| 404 | 文件不存在 / 扫描不存在 / 智能合集不存在 / 视频封面未生成（body 含 `code: "video_cover_missing"`） |
| 413 | 上传 > 5 MB |
| 415 | 格式不支持（图片格式 / 视频格式 / 上传字节不是合法图片） |
| 500 | 服务端错误 |

---

## 14. 服务端配置

通过 `backend/config.yaml` 配置。完整示例见 [`backend/config.example.yaml`](../backend/config.example.yaml)。

```yaml
# 媒体根目录（数组，必填；旧 mediaRoot / comicRoot 兼容）
mediaRoots:
  - "E:\\照片"
  - "F:\\漫画"

host: "0.0.0.0"
port: 8080
cacheDir: ".local-gallery"     # 留空 → CWD 下 .local-gallery/
thumbSizeW: 320
thumbSizeH: 350
thumbCacheSize: 500
cacheMaxAgeDays: 30
allowOsOpen: false
staticDir: "dist"             # 前端构建产物目录

# ---- 扫描排除规则（v3.1 引入）----
# 模式仅匹配单个路径段(basename),不跨 / 边界。
# 内置:skipHidden=true 时所有 .开头的目录(.git / .cache / ...)整体不进;
#       Thumbs.db / desktop.ini / .DS_Store 永远不进（不可关闭）;
# 下面三项用户可改 / 追加。
skipHidden: true              # 跳隐藏目录
excludePatterns: []           # 用户 glob 列表(任意深度),如 [node_modules, "temp*"]
systemFiles: []               # 在内置白名单之上追加系统噪声
```

**启动参数只保留** `--config <yaml>` 和 `--static-dir <dir>`。**不再支持环境变量或 CLI 覆盖**。

### 网页运行时改配置

`GET /api/config` 读，`PUT /api/config` 部分更新（bool 字段必须显式传）。

```json
PUT /api/config
{ "thumbSizeW": 400, "allowOsOpen": true }
```

响应：

```json
{
  "ok": true,
  "config": { "...": "更新后的完整配置" },
  "requiresRestart": [],
  "mediaRootsChanged": false
}
```

| 字段 | 行为 |
|------|------|
| `mediaRoots` | 热生效：路径安全 + 扫描器改读新根，旧扫描结果清空 |
| `cacheDir` / `thumbSize*` / `thumbCacheSize` / `cacheMaxAgeDays` / `ffmpegPath` | 热生效 |
| `allowOsOpen` | 热生效：`/api/fs/open` 立即按新值放行 |
| `skipHidden` / `excludePatterns` / `systemFiles` | 热生效：下次扫描按新规则；旧扫描结果不自动清空（建议点「重新扫描」） |
| `host` / `port` / `staticDir` | **需重启**（监听 / 静态托管启动期绑定） |
| `mediaRootsChanged` | 提示本次是否清空了扫描缓存 |
| `requiresRestart` | 列出需重启的字段 |

校验失败 → 400：`{ "error": "validate: invalid port 0" }`。

---

## 15. curl 一把梭

```bash
# 健康
curl -s http://localhost:8080/api/health | jq

# 异步扫描
SCAN=$(curl -sX POST http://localhost:8080/api/scan/start | jq -r .scanId)

# 订阅进度（带过滤）
curl -N http://localhost:8080/api/scan/$SCAN/events

# 拉详情
curl -s "http://localhost:8080/api/folders?path=$(python -c 'import urllib.parse;print(urllib.parse.quote("E:\\图像\\[作者A]\\卷01"))')" | jq

# 缩略图
curl -so /tmp/thumb.jpg "http://localhost:8080/api/thumbs?path=$(...)"

# 视频元数据
curl -s "http://localhost:8080/api/videos/info?path=$(...)" | jq

# 收藏
curl -sX POST http://localhost:8080/api/favorites -H "Content-Type: application/json" -d '{"path":"/path"}'
```
