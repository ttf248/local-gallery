# Local Gallery · HTTP / SSE API 文档

本文件是当前后端全部 HTTP 与 SSE 接口的完整参考，路由定义以 [`backend/cmd/server/main.go`](../backend/cmd/server/main.go) 为准。

> **安全边界**：所有公共媒体与业务接口均仅使用服务端生成的不可逆资源 ID（`r_` / `a_` / `c_` / `f_`）。除受本机回环限制的配置与管理端点外，URL、请求体、响应体与错误信息均不得包含文件系统绝对路径。

---

## 1. 通用约定

### 访问控制与认证

- **默认地址**：`http://127.0.0.1:8080`。
- **`accessMode: local`（默认）**：仅接受本机回环请求与 `localhost` / 回环 IP `Host`。
- **`accessMode: lan`**：仅允许通过 IP 或 `host` 配置的主机名访问；除最小健康检查与认证会话端点外，所有请求均须携带 `Authorization: Bearer <token>` 或有效 `HttpOnly` 会话 Cookie（不接受 query 传令牌）。所有模式均拒绝任意域名 `Host` 与跨源请求。内置服务不终止 TLS，LAN 模式仅适用于可信局域网。
- **回环独占管理接口**：标注为「仅回环」的端点额外经过 `LoopbackOnly` 中间件，LAN 远程客户端即使已认证也返回 `403 local_access_required`。

### 资源 ID 与分页游标

- 资源前缀：`r_`（媒体根）、`a_`（相册/卷）、`c_`（集合/文件夹/作品）、`f_`（媒体文件）、`smart:<tag>`（方括号标签标识）。
- 列表分页默认 `limit=60`、上限 `200`；响应统一为 `{ "ok": true, "page": { "revision": 42, "items": [], "total": 0, "nextCursor": "..." } }`，并附带 `ETag: W/"library-<revision>"`。
- 游标带签名并绑定库 `revision`、内容属性（`kind=photo|comic`）与筛选条件：篡改或跨模式/跨条件复用返回 `400 invalid_cursor`，媒体库更新后返回 `409 stale_cursor`（客户端须清空已合并分页并重新拉取）。

### 统一错误格式与常用错误码

所有 4xx/5xx 响应均返回机器可读错误对象：

```json
{ "code": "snake_case_id", "message": "human readable description", "details": {} }
```

| HTTP | 常见 `code` | 说明 |
| --- | --- | --- |
| 400 | `invalid_resource_id` / `invalid_resource_kind` / `invalid_kind` / `invalid_cursor` / `invalid_config` / `invalid_tag` | 参数、ID、工作台属性或游标非法 |
| 401 | `unauthorized` | LAN 模式下缺少或无效的令牌/会话 |
| 403 | `local_access_required` / `os_open_disabled` / `online_meta_disabled` | 非回环访问管理接口，或对应可选能力未开启 |
| 404 | `resource_not_found` / `media_not_found` / `video_not_found` / `source_not_found` / `video_cover_missing` / `album_not_found` / `tag_not_found` | 资源不存在、已失效、类型变化或视频封面待抽帧 |
| 409 | `stale_cursor` / `analysis_job_active` / `state_changed` / `library_not_ready` / `similarity_status_conflict` | 游标过期、任务冲突或并发状态变化 |
| 413 | `state_backup_too_large` | 状态备份导入超过 34 MiB 上限 |
| 415 | `unsupported_format` / `unsupported_image_format` / `unsupported_video_format` | 非受支持格式或缺少 FFmpeg 转换能力 |
| 416 | `invalid_range` | 无效字节范围或多段 Range |
| 429 | `too_many_auth_attempts` | 5 分钟内认证失败超过 8 次 |
| 503 | `ai_runtime_unavailable` / `ai_model_missing` / `ai_module_unavailable` | 本地 AI 运行时或模型未就绪 |

### SSE 与缓存协商约定

- **SSE**：响应类型 `text/event-stream`，每 15 秒发送 `: keep-alive` 注释心跳；终态后关闭连接，客户端断连释放订阅但不取消共享后台任务。
- **ETag / 304 / Range**：
  - 渲染图（`/api/thumbs/:id`、`/api/previews/:id`）强 ETag 为 `"<mtime_ns>-<size>-r<algo>-<width>"`；原图与视频（`/api/media/:id`）强 ETag 为 `"<hex_mtime_ns>-<hex_size>"`。
  - 支持 RFC 9110 弱比较 `If-None-Match` 与原图/视频的 `If-Modified-Since`；源路径实时校验先于条件判断，4xx 响应不携带 ETag。
  - 默认 `Cache-Control: private, no-cache`；渲染图携带与当前源匹配的 `?v=<version>` 时返回 `Cache-Control: private, max-age=31536000, immutable`。
  - `/api/media/:id` 支持单段 `Range` 与强校验 `If-Range`（条件不匹配时返回完整 `200`）。

---

## 2. 健康、认证与服务端配置

| 方法与路径 | 访问级别 | 说明 |
| --- | --- | --- |
| `GET /api/health` | 公开 / 认证 | LAN 未认证仅返回 `{ status, accessMode }`；本地或已认证额外返回 `version`、`goVersion`、`goroutines`、`mediaRoots`（仅 `r_` ID）、`allowOsOpen` |
| `GET /api/auth/session` | 公开 | 返回 `{ authenticated, mode }` |
| `POST /api/auth/session` | 公开 | 请求 `{ token }`（最大 1 KiB，令牌 32–256 字符），成功后下发 8 小时 `HttpOnly; SameSite=Strict; Path=/api` Cookie；失败限流 5 分钟 8 次 |
| `DELETE /api/auth/session` | 已认证 | 销毁服务端会话并清除 Cookie |
| `GET /api/config` | 仅回环 | 读取当前配置、`configPath`、`ffmpegAvailable` 与 `accessTokenConfigured`（永不回显明文令牌） |
| `PUT /api/config` | 仅回环 | 部分更新配置并写回 YAML。支持字段：`mediaRoots`（`[{ path, kind: "photo"\|"comic" }]`）、`host`、`port`、`accessMode`、`accessToken`、`cacheDir`、`thumbCacheSize`、`cacheMaxAgeDays`、`cacheMaxSizeMB`（`0..1048576`）、`ffmpegPath`、`allowOsOpen`、`staticDir`、`skipHidden`、`excludePatterns`、`systemFiles`、`comicMeta`（`onlineEnabled`/`provider`/`timeoutSec`/`proxyURL`）。响应含 `requiresRestart`、`mediaRootsChanged` 及可选 `scanId` / `scanStartError`。`host`/`port`/`cacheDir`/`ffmpegPath`/`staticDir` 需重启，其余热生效；媒体根路径或属性变更自动触发重扫 |
| `POST /api/fs/open` | 仅回环 | 请求 `{ id }`，在服务端系统文件管理器中定位资源（需 `allowOsOpen: true` 并实时重验路径与文件类型） |
| `GET /api/admin/fs/open` | 仅回环 | 参数 `?path=<已配置路径>&allowConfig=1`，设置页打开已配置目录 |
| `POST /api/admin/fs/directories` | 仅回环 | 请求 `{ directory?, after? }`，分页列出本机直属子目录（每页最多 200 项，跳过链接，返回 `directory`/`parent`/`roots`/`items`/`nextAfter`，`Cache-Control: no-store`） |

---

## 3. 扫描、媒体库与文件监听

### 扫描与同步

| 方法与路径 | 说明 |
| --- | --- |
| `POST /api/scans` | 启动后台扫描，返回 `{ scanId, reused }`；已有活动扫描时复用 |
| `GET /api/scans/:id/events` | SSE 订阅扫描进度，事件名：`pending` / `running` / `complete` / `cancelled` / `error`；`currentPath` 仅含根别名与相对路径 |
| `DELETE /api/scans/:id` | 取消扫描，已取消任务不写入快照与磁盘缓存 |
| `DELETE /api/library` | 取消活动扫描并清空内存快照与磁盘扫描缓存（不立即重扫） |
| `GET /api/library-sync` | 查询实时文件监听状态：`enabled`、`autoAnalyze`、`running`、`degraded`、`watchedRoots`、`watchedDirs`、`maxWatchDirs`、`pendingChanges`、`pendingAnalysis`、`lastEventAt`/`lastVerifyAt`/`lastSyncAt`、`lastDetected`/`lastUpdated`/`lastFailed`、`lastError`、`libraryRevision` |
| `PUT /api/library-sync` | 更新 `{ enabled?, autoAnalyze? }` 并持久化至 `state/library_sync.json` |

### 媒体库浏览与检索

除 `/manifest`、`/nodes/query`、`/tags/query` 与 `/albums/:id/media` 外，其余列表接口均要求必填 `kind=photo|comic`：

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/library/manifest` | 返回根目录列表（含 `contentKind`）、扫描时间、全库与分属性相册/集合统计，以及至多前 100 条脱敏 `warnings` |
| `GET /api/library/overview` | 统一列表查询，支持 `kind`、`parent` / `tag`（互斥）、`view=all\|album\|collection\|smart`、`q`、`year=1900..2099\|other`、`minImageCount`、`sort=name\|count\|added\|recent\|viewed`、`excludeYearTargets=1`、`episodeType=all\|main\|extra`、`limit`、`cursor`。返回分页节点及作用域统计 `counts`、`scopeCounts`、`years`、`series`、`imageTotal`、`videoTotal`、`completedCount` |
| `GET /api/library/:id/children` | 分页返回指定根或集合的直属相册与子集合摘要 |
| `POST /api/library/nodes/query` | 请求 `{ ids: [...] }`（上限 500），不受工作台过滤，按输入顺序返回节点摘要及 `missing` |
| `GET /api/library/media-feed` | 跨相册照片流，必填 `kind` 与 `scope`：`year`（按目录年份）、`collection`（指定集合轮流交错）、`recent`、`random`（支持 `seed`）、`stream`（确定性随机长流，支持 `seed` + 游标）、`timeline`（照片侧全库单张拍摄证据时间线，支持 `year`/`month`/`media`/`dateSource`/`datePrecision`，响应含 `years`/`unknown`/`dateSources`/`datePrecisions`/`albums`） |
| `GET /api/library/recent` | 返回最近加入的相册摘要（按业务日期倒序，不分页） |
| `GET /api/library/photo-memories` | 必填 `?date=YYYY-MM-DD`，返回往年同月同日优先（不足按月日距离补足）的至多 8 条去重回忆媒体 |
| `GET /api/library/on-this-day` | 可选 `month`/`day`/`limit`/`fallback=1`，返回往年同月同日拍过照的相册及命中日期 `matchedDate` |
| `GET /api/library/activity-summary` | 返回当前 `kind` 的 `albumCount` 与 `unreadCount`（照片侧未读恒为 0） |
| `GET /api/library/dashboard` | 返回漫画首页所需的 `albumCount`、`unreadCount`、至多 6 本 `unread` 与全部 `inProgress` |
| `GET /api/library/unread` | 分页返回漫画未读列表；支持 `groupBy=work` 按作品分页、`workId` 限定作品、`q` 搜作品或作者 |
| `GET /api/albums/random` | 随机抽取相册摘要，`scope=unread` 仅抽未读，`count=1..12`（默认 1） |
| `GET /api/albums/:id/media` | 分页返回相册媒体（含 `index`/`kindIndex`/`width`/`height`/`picked`/`undecodable`/`similarityGroup`）；照片相册另支持整本筛选参数：`from`/`to`（`YYYY-MM`）、`personId`、`adcode`、`picks=only\|none`、`scene=groupPhoto\|similar`、`collapse=1`、`expand=<groupId>`，并返回 `unresolved` 与 `grouped` 统计 |
| `GET /api/albums/:id/filters` | 返回该相册真实可用的筛选面（`time`/`people`/`places`/`picks`/`groupPhotos`/`similarity`）及缺失原因 |
| `PUT /api/albums/:id/cover` | `?file=<fileId>` 设置相册自定义封面（须为相册内受支持媒体） |
| `DELETE /api/albums/:id/cover` | 清除相册自定义封面 |
| `PUT /api/collections/:id/cover` | `?file=<fileId>` 设置作品/文件夹自定义封面（须在子树内） |
| `DELETE /api/collections/:id/cover` | 清除作品/文件夹自定义封面 |
| `GET /api/search` | 名称与标签搜索，参数 `q`、`kind`、可选 `type=album\|collection\|smartCollection`、`limit`（默认 50，上限 500）、`cursor`。结果带命中理由 `match`（`exact`/`prefix`/`contains`/`tag`/`path`） |
| `GET /api/tags` | 按 `kind` 分页返回标签摘要 |
| `POST /api/tags/query` | 请求 `{ names: [...] }`（上限 500），不受工作台过滤，同时返回 `photoAlbumCount` 与 `comicAlbumCount` |
| `GET /api/tags/:tag/albums` | 按 `kind` 分页返回标签下的相册（`:tag` 仅解码一次，保留 `+`/`%`） |

> 受支持媒体扩展名由后端 `models.ImageExts`（`jpg/jpeg/jfif/png/gif/bmp/webp/tiff/tif/heic/heif`）与 `models.VideoExts`（`mp4/m4v/webm/mov/mkv/avi/3gp`）统一判定。

---

## 4. 漫画作品元信息

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/comics/:id/meta` | 返回 `{ ok, revision, meta }`，含规范书名、原名、作者、题材、`fullSynopsis`、`aliases`、来源、`confidence`、`hasCustomCover`、封面候选及首篇入口 |
| `PUT /api/comics/:id/meta` | 提交人工覆盖：`title`（≤120）、`author`（≤80）、`synopsis`（≤2000）、`genres`（≤8 项，每项 ≤24）、`status`、`locked` |
| `DELETE /api/comics/:id/meta` | 清除人工覆盖，恢复自动解析视图 |
| `POST /api/comics/:id/meta/refresh` | 请求 `{ force?, allowOnline? }`，重读本地元数据并抽取卷首识别；未在配置开启公开匹配却传 `allowOnline: true` 返回 `403 online_meta_disabled` |

---

## 5. 媒体、渲染图与视频转码

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/media/:id` | 流式发送原图或视频（支持 ETag / 304 / Range / If-Range；HEIC/HEIF/TIFF 自动经 FFmpeg 转 JPEG 缓存；视频按需走转码/faststart 管线；前端可附 `?playback=<id>` 隔离解码缓冲） |
| `GET /api/previews/:id` | 返回按宽度缩放的 JPEG 预览图（`w` 默认 1600，向上对齐至 `320/640/1280/1920/2560/4096`；支持 `?v=` 长期缓存；源图更窄时返回原图） |
| `GET /api/thumbs/:id` | 返回等比不裁剪的 JPEG 渲染图（`w` 默认 640，同上档位阶梯，支持 `?v=`）；视频缺封面时返回 `404 video_cover_missing` |
| `POST /api/thumbs/:id/cover` | 上传浏览器抽取的视频封面（JPEG/PNG 原始字节，上限 5 MiB） |
| `GET /api/thumbs/:id/portrait/:person/:index` | 返回按人脸归属与指纹复核后裁切的方形人物头像（默认 160px，支持 `?w=320`） |
| `GET /api/images/:id/info` | 返回图片尺寸、格式、大小、修改时间、checksum 及脱敏父目录 `dir` |
| `GET /api/images/:id/metadata` | 返回匹配当前指纹与版本的 EXIF（拍摄时间、光圈、焦距、曝光、ISO、相机）与 GPS；未分析时返回 `status: "pending"` |
| `GET /api/images/:id/analysis` | 返回匹配当前指纹与版本的 OCR 文本/框与人脸框/置信度（不返回特征向量） |
| `GET /api/videos/:id/info` | 返回视频基础信息、ffprobe/ffmpeg 元数据与转码状态 |
| `POST /api/videos/info/batch` | 请求 `{ ids: [...] }`（上限 100），保序返回逐项 `info` 或单项 `code` |
| `GET /api/videos/:id/transcode/status` | 查询视频转码状态（`cached` / `not_needed` / `pending` / `queued` / `running` / `failed` / `cancelled` / `unavailable`） |
| `GET /api/videos/:id/transcode/events` | SSE 订阅转码进度，事件名：`progress` / `done`，载荷 `{ status, progress, etaSec, error? }` |
| `POST /api/videos/:id/transcode/cancel` | 取消正在进行的视频转码任务 |

---

## 6. 偏好、收藏、精选、历史与媒体活动

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/prefs` / `PATCH /api/prefs` | 读写服务端偏好（`theme`、`sidebarCollapsed`、`maxRecent`、`autoSwitchAlbum`、`showSwitchNotif`、`appMode`、`hiddenNavItems`）；不包含收藏与历史数组 |
| `GET /api/favorites` | 返回 `{ favorites: [...] }`（上限 500 项） |
| `POST /api/favorites` / `DELETE /api/favorites` | 请求 `{ resourceId }`（支持 `a_`/`c_`/`smart:<tag>`） |
| `POST /api/favorites/batch` | 请求 `{ resourceIds, action: "add"\|"remove" }`（1–1,000 项），一次原子落盘 |
| `POST /api/favorites/prune` | 按当前资源目录移除失效相册/集合收藏，保留智能标签；库未就绪返回 `409` |
| `GET /api/picks` | 返回 `{ ok, picks, total, revision }`（照片级精选，上限 5,000 条，最近加入在前） |
| `POST /api/picks/batch` | 请求 `{ ids, action: "add"\|"remove" }`（上限 1,000 项） |
| `GET /api/picks/media` | 分页返回跨相册精选照片（含 `albumId`/`albumName` 与同时间线口径的 `dateSource`/`datePrecision`/`dateValue`） |
| `GET /api/history` / `DELETE /api/history` | 获取或清空最近访问历史 |
| `POST /api/history` | 请求 `{ albumId, name, imageCount }` 记录相册/卷访问 |
| `DELETE /api/history/:albumId` | 幂等删除指定相册的访问记录 |
| `GET /api/activity` | 查询单条活动：`?albumId=<id>&mediaKind=image`（视频另需 `itemId=<fileId>`），不存在返回 `404 activity_not_found` |
| `PUT /api/activity` / `DELETE /api/activity` | 幂等写入或删除单条活动（漫画传 `pageIndex`/`pageCount`，到达末页派生 `completed`；视频传 `itemId`/`positionMs`/`durationMs`，到达 98% 派生 `completed`） |
| `POST /api/activity/query` | 批量精确查询活动记录 |
| `PUT /api/activity/batch` | 批量写入活动（上限 10,000 条，单次原子落盘） |
| `DELETE /api/activity/batch` | 请求 `{ albumIds }`（1–1,000 项），仅重置漫画图片阅读活动，保留视频播放位置 |
| `POST /api/activity/works/:id/mark-read` | 对漫画作品集合执行 `mode: "mark_read" \| "reset"`，返回 `updatedCount` 与 `affectedAlbums` |
| `DELETE /api/activity/all` | 清空全部图片与视频活动记录 |

---

## 7. 媒体分析任务与存储

### 任务队列、计划与控制

支持模块类型：`metadata`、`embedding`、`ocr`、`face`、`portrait`、`similarity`、`albumCover`、`comicCover`、`comicMeta`。

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/ai/jobs` | 返回任务快照：`jobs`（倒序）、`active`、`queue`、`settings`、`modules`（全部已注册模块及就绪状态） |
| `POST /api/ai/jobs` | 启动单模块任务 `{ type, mode: "full"\|"incremental", albumId? }`（`albumId` 仅适用于照片相册） |
| `POST /api/ai/jobs/sequence` | 按序排队多个已就绪模块 `{ mode, modules?, albumId? }`；省略 `modules` 时按默认全库或相册序列排入，未就绪模块列于 `skippedModules` |
| `GET /api/ai/jobs/estimate` | 只读核算各模块在增量与全量下的待处理张数（已扣除 `knownFileFailures`）及基于历史中位速度的预计耗时 |
| `GET /api/ai/jobs/:id` / `GET /api/ai/jobs/:id/events` | 查询单任务快照或通过 SSE 订阅（事件名同任务状态：`pending`/`running`/`paused`/`completed`/`failed`/`cancelled`） |
| `GET /api/ai/jobs/:jobId/output` | 按需查询指定任务已提交批次的相对目录与磁盘占用 |
| `POST /api/ai/jobs/:id/pause`、`POST /api/ai/jobs/:id/resume`、`POST /api/ai/jobs/:id/cancel`、`POST /api/ai/jobs/:id/retry` | 在批次边界暂停、继续、取消，或为失败/未完成尾段创建重试任务 |
| `POST /api/ai/jobs/:id/move` | 请求 `{ direction: "up"\|"down" }` 调整等待队列顺序 |
| `DELETE /api/ai/jobs/queue` | 取消全部等待中任务（不影响当前活动任务） |
| `DELETE /api/ai/jobs/:id` / `DELETE /api/ai/jobs/history` | 删除单条或全部已结束任务记录（不删除派生分析结果） |
| `GET /api/ai/jobs/settings` / `PUT /api/ai/jobs/settings` | 读写每日计划（`dailyEnabled`、`dailyTime` `HH:MM`、`dailyScan`、`dailyModules`、`dailySmartAlbums`、`peopleEnabled`） |
| `PUT /api/ai/jobs/hardware` | 请求 `{ gpuEnabled: boolean }`，设置新建模型任务的硬件偏好 |
| `PUT /api/ai/jobs/face-model` | 请求 `{ model: "quality-v2"\|"buffalo_m" }`，切换人脸模型并加载对应隔离索引（运行人脸任务或每日计划期间返回 `409`） |

### 内容搜索与存储状态

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/ai/semantic/status` | 返回 Python 运行时、CUDA / DirectML / ONNX Runtime 可用性、各模型就绪与校验状态、向量覆盖率及 `portable` 标记 |
| `POST /api/ai/search` | 融合检索：支持 `text`（语义）、`resourceId` 或 multipart `image`（以图搜图，上限 64 MiB）三选一，可组合 `ocrText`（≤200 字）、`matchMode`（`all`\|`any`）、`albumId`、`year`、`adcode`、`personId`、`favoriteOnly`、`pickedOnly`，必填 `kind`；返回去重分页结果与 `matchReasons`（`semantic`/`similar_image`/`ocr_exact`/`ocr_approximate`） |
| `POST /api/ai/faces/search` | 请求 `{ resourceId, faceIndex }`，按当前人脸模型查找库内相似人脸照片（至多 40 条，阈值 `0.363`，不返回特征向量） |
| `GET /api/storage/usage` | 返回模型权重与各模块产物的磁盘占用与相对路径（30 秒 TTL，`Cache-Control: no-store`） |
| `GET /api/storage/paths` | **仅回环**：返回工作目录、配置文件、缓存根目录、Python 环境及各模型权重的本机绝对路径 |

---

## 8. 人物相册与标注工作台

| 方法与路径 | 访问级别 | 说明 |
| --- | --- | --- |
| `GET /api/people` | 普通 | 无 `q` 时返回常见人物（每页至多 50，支持 `offset`、`sort=photos\|review`、`includeHidden=true`）；带 `q` 时搜索全部候选组（上限 50）。含 `coverFace` 与 `portraitUrl` |
| `PUT /api/people/:id` | 普通 | 请求 `{ name?, hidden? }`，空名称恢复自动序数名 |
| `DELETE /api/people` | 普通 | 关闭人物分析并清除人脸分析结果、人物索引与人工修正（活动任务时返回 `409`） |
| `GET /api/people/:id/media` | 普通 | 分页返回人物照片 DTO 及人脸框/序号（`faceIndex` `0..255`） |
| `GET /api/people/:id/portraits` / `PUT /api/people/:id/portraits` | 普通 | 分页获取按质量排序的候选头像列表；`PUT { key }` 手选头像，空串恢复自动精选 |
| `POST /api/people/merge` | 普通 | `{ sourceId, targetId }` 合并两个候选组 |
| `POST /api/people/split` | 普通 | `{ personId, faceKeys }`（上限 200）拆出新组，原组至少保留 1 张脸 |
| `GET /api/people/matches` | 普通 | 分页返回待确认匹配源组及至多 3 个目标建议，附 `risk`（`low`/`medium`/`high`）、`riskReasons` 与互证照片框 |
| `POST /api/people/matches/exclude`、`POST /api/people/matches/retain` | 普通 | 永久排除一对匹配建议（`{ sourceId, targetId }`）或将源组固定保留至常见人物（`{ personId }`） |
| `GET /api/people/group-photo-candidates` | 普通 | 分页返回仅出现在合照中的未确认组及统计分位数 |
| `GET /api/admin/people/annotations/samples` | 仅回环 | 返回或刷新（`refresh=true`）待标注评测样本清单与进度 |
| `GET /api/admin/people/annotations/photo/:resourceId` / `POST .../photo` | 仅回环 | 读取照片检出人脸与已有标注，或保存标注结果 |
| `GET /api/admin/people/annotations/identities` / `POST .../identities` | 仅回环 | 列出或新建匿名标注身份 |
| `GET /api/admin/people/annotations/progress` | 仅回环 | 返回标注进度统计 |
| `GET /api/admin/people/annotations/dataset` | 仅回环 | 导出 `schemaVersion: 1` 本地评测集（含绝对路径，供 `evaluate_people.py` 使用） |

---

## 9. 离线足迹与地点地图

统计与媒体端点共享可选时间参数 `from` / `to`（`YYYY-MM`，按 EXIF 拍摄月闭区间过滤，参与 ETag）：

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/locations/china` | 返回全国统计（含 `totalPhotoCount`、`gpsPhotoCount`、34 省计数、`months`、`trajectory`、`untimedPhotoCount`；不含绘图几何） |
| `GET /api/locations/china/regions/:adcode` | 返回指定行政区摘要、祖先面包屑 `ancestors`、直接下级计数、`months`、`trajectory` 与代表照 |
| `GET /api/locations/china/regions/:adcode/visits` | 返回按日历日间隔 ≤2 天切分的到访记录列表 |
| `GET /api/locations/china/regions/:adcode/media` | 分页返回指定行政区照片（支持 `?visit=<序号>` 筛选单次到访） |
| `GET /api/locations/china/geometry/:level` | 下发简化绘图轮廓（`province` / `city` / `district` / `children`，可带 `parent=<adcode>`），静态数据带 `max-age=86400` 缓存 |
| `GET /api/locations/china/geometry/features` | `?adcodes=110000,310104` 按区划码直接批量取简化轮廓 |
| `GET /api/locations/china/points` | 返回照片位置网格聚合（`cell` 仅限 `0.01/0.02/0.05/0.1/0.2/0.5`，超 4000 格自动调粗；无拍摄时间照片保留并单独计入 `untimed`；不返回单张坐标） |
| `GET /api/locations/china/places` | 返回有照片的地点索引，支持 `level=province\|city\|district` 与 `parent` |
| `GET /api/locations/china/trips` | 返回行程与停留列表（`granularity=province\|city\|district`，默认 `city`；`gapDays=1..365`，默认 `14`），每段含均匀采样 `bandResourceIds`（至多 12 张） |
| `GET /api/locations/china/trips/:index/media` | 分页返回指定序号行程的照片（须与列表查询保持相同 `granularity`、`gapDays` 与 `from`/`to`） |

---

## 10. 智能相册与全库刷新

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/smart-albums` | 跨照片相册分页列出已缓存分组：`dimension=recommended\|time\|place\|people\|scene\|all\|featured`（默认 `recommended`），`recommended` 支持 `sort=time\|photos\|quality` |
| `POST /api/smart-albums/refresh` | 请求 `{ force?: boolean }` 启动后台全库五维刷新（复用运行中任务） |
| `GET /api/smart-albums/refresh/active` / `:id` | 查询当前或指定刷新任务进度快照（未运行过返回 `task: null`） |
| `GET /api/smart-albums/refresh/:id/events` | SSE 订阅刷新进度（`pending`/`running`/`complete`/`cancelled`/`error`） |
| `DELETE /api/smart-albums/refresh/:id` | 取消进行中的全库刷新 |
| `GET /api/albums/:id/smart-groups` | 返回指定照片相册某维度（`?dimension=`）的分组摘要、分析覆盖率与未分组张数 |
| `POST /api/albums/:id/smart-groups/rebuild` | 按当前分析记录重建指定相册的选定维度 |
| `PUT /api/albums/:id/smart-groups/:groupId` | 请求 `{ name?, hidden? }`（名称 ≤60 字符，空串恢复建议名），持久化至 `state/smart_album_overrides.json` |
| `GET /api/albums/:id/smart-groups/:groupId/media` | 分页返回该分组成员照片（每页重验成员归属、路径与文件指纹） |

---

## 11. 相似照片与连拍整理

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/similarity/status` | 返回已分析数、总数、语义索引可用性、分组时间、`stale`/`rebuilding`/`limited` 标记与汇总计数 |
| `GET /api/similarity/groups` | 分页返回分组，支持 `kind=exact\|near\|burst`、`status=pending\|reviewed\|ignored`、`folder`、`resourceId`、`limit`（≤200）、`offset`；每组成员含清晰度/分辨率/曝光可解释质量分 |
| `PUT /api/similarity/groups/:id` | 更新单组人工决定：`status`（`pending`/`reviewed`/`ignored`）、`representative`（须为组内成员）、`expectedStatus`（并发乐观锁，不匹配返回 `409 similarity_status_conflict`），返回 `previousStatus` 与 `changed` |
| `POST /api/similarity/batch` | 批量执行 `action: "review"\|"unreview"\|"ignore"\|"unignore"\|"pick"\|"restore"`；`pick` 将代表照片加入精选，`restore` 按 `{ groupId, from, to }` 逐组精确撤销并报告 `conflicts` |
| `POST /api/similarity/rebuild` | 按当前特征重算三类分组并迁移人工决定 |

---

## 12. 派生缓存管理与状态备份恢复

### 派生缓存

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/cache/stats` | 返回 `derived/` 总占用（`totalBytes`/`fileCount`）、五类媒体派生缓存合计（`mediaBytes`/`mediaFileCount`）及逐项细分（`thumbs`/`converted`/`previews`/`videoFaststart`/`videoTranscode`，30 秒 TTL） |
| `POST /api/cache/clear` | 必填 `?scope=thumbs\|converted\|previews\|faststart\|transcode\|all`，清空对应派生目录（`all` 同步重置视频元数据内存缓存），绝不触及 `state/` |
| `POST /api/thumbs/cleanup` | 清理过期缩略图缓存 |
| `POST /api/cache/rebuild` | 请求 `{ scopes: ["thumbs"\|"previews"], previewWidth? }` 启动后台派生缓存重建（不涉及视频） |
| `GET /api/cache/rebuild/:id`、`GET /api/cache/rebuild/:id/events`、`DELETE /api/cache/rebuild/:id` | 查询重建进度、SSE 订阅（运行期间每 500ms 推一次）或取消任务 |

### 本机状态备份与恢复（全部仅回环，`Cache-Control: no-store`）

覆盖全部 **10 类状态**：`favorites`、`history`、`preferences`、`activities`、`covers`、`picks`、`people`、`smartAlbums`、`similarity`、`comicOverrides`。不含 `config.yaml`、令牌、扫描缓存或浏览器本机阅读偏好。

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/admin/state/export` | 导出 v1 JSON 状态备份（无法解析的旧封面计入 `unresolvedCovers` 不导出） |
| `POST /api/admin/state/import/preview` | 提交 `{ backup }`（接口上限 34 MiB，前端文件上限 32 MiB），校验格式并返回各分类 `versions` 摘要、`libraryRevision`、`counts`、`missing` 与 `skippedCovers` |
| `POST /api/admin/state/import` | 提交 `{ backup, categories, versions, libraryRevision }` 按选定类别恢复。写入前先在 `state/backups/` 留存恢复前备份；状态变化返回 `409 state_changed`，历史上限冲突返回 `400 history_limit_conflict`，失败停止后续类别且客户端不自动重放 |
