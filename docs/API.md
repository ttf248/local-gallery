# HTTP API

> 当前接口契约只接受服务端生成的资源 ID。除本机配置管理接口外，响应、URL 和请求体均不得出现绝对文件系统路径。

## 通用约定

- 基础地址：`http://127.0.0.1:8080`。
- `accessMode=local` 时所有 API 只接受回环请求和 `localhost`/回环 IP Host；`accessMode=lan` 时可使用 IP 或 `host` 中明确配置的主机名，仅健康检查与会话端点公开，其余 API 必须带 Bearer 令牌或有效 HttpOnly 会话 Cookie。令牌不接受 query 参数。所有模式都会拒绝任意域名 Host 与浏览器跨源请求。
- 内置服务器不终止 TLS；LAN 模式只面向可信家庭网络，不应直接暴露到互联网或不可信 Wi-Fi。同网段监听者仍可能看到首次登录令牌或明文 HTTP 会话。
- 资源校验错误使用 `{ "code": "...", "message": "..." }`；媒体不存在或 ID 已过期时重新扫描。所有 4xx/5xx 响应统一为：

  ```json
  { "code": "snake_case_id", "message": "...", "details": {} }
  ```

  `code` 是稳定字符串，前端用此做 `if (err.code === 'video_cover_missing')` 区分。

- `r_`、`a_`、`c_`、`f_` 分别表示根、相册、集合和文件资源 ID。
- 资源 ID 在根目录和相对路径不变时保持稳定，不包含可逆的绝对路径信息。
- SSE 响应使用 `text/event-stream`，客户端断开后服务端必须清理订阅。
- SSE 事件名：扫描用 `pending / running / complete / cancelled / error`，
  转码用 `progress / done`（与扫描命名空间分离，避免命名冲突）。
- 错误响应 code 速查（持续扩充）：
  - `missing_resource_id` (400) - 缺少资源 ID
  - `unsupported_video_format` (415) - 视频扩展名不在白名单
  - `unsupported_format` (415) - 缩略图不支持的图片格式
  - `video_not_found` (404) - 视频文件不存在
  - `source_not_found` (404) - 缩略图源文件不存在
  - `video_cover_missing` (404) - 视频封面未生成，前端抽帧后回传
  - `stat_failed` (500) - os.Stat 系统错误
  - `media_read_failed` (500) - 媒体打开或读取文件信息失败
  - `invalid_range` (416) - 媒体字节范围无效、不支持多段范围或未命中文件大小
  - `thumbnail_error` (500) - 缩略图生成失败
  - `invalid_resource_id` (400) - 资源 ID 解析失败
  - `album_not_found` (404) - 相册路径不在当前扫描结果中
  - `local_access_required` (403) - 本机管理接口只接受回环请求

### ETag / 304 协商

`/api/thumbs/:fileId`、`/api/previews/:fileId` 和 `/api/media/:fileId` 在 200 响应中带 `ETag` 头，值为**双引号包裹**的派生标识：

- 渲染图（缩略图 / 预览图）：`"<内容版本号>-<档位宽度>"`，内容版本号形如 `<mtime_ns>-<size>-r<算法版本>`
- 媒体文件：`"<hex_mtime_ns>-<hex_size>"`

渲染图的 ETag 由源文件版本与渲染档位派生，不再对响应字节做哈希：同一个版本与档位渲染出的字节是确定的，因此条件请求只要一次 stat 加一次字符串比较，不必先把整张图读进内存算 sha256。

客户端带 `If-None-Match` 命中当前 ETag 时返回 `304 Not Modified` + 空 body。按 [RFC 9110 §13.1.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2) 使用弱比较：当前 ETag 为 `"abc"` 时，`W/"abc"`、`"old", "abc"` 均可命中；`*` 对存在的资源也返回 304。重复字段行按逗号列表合并，引号内的逗号属于标识内容。标识仍须带双引号，格式错误的列表不命中；该弱比较不用于 If-Range。

源文件不存在或失效时先返回 404，通配符不绕过源校验。原图、视频和渲染图默认使用 `Cache-Control: private, no-cache`，成功及 304 响应保留此策略；原图和视频的 200、206、304 均携带 ETag。缓存条件命中先于 Range 判断，304 不携带 Content-Range。

渲染图另有一种可长期缓存的形态：请求带上 `?v=<内容版本号>` 且该版本号与当前源文件一致时，响应改为 `Cache-Control: private, max-age=31536000, immutable`。版本号一致意味着源文件没动、渲染算法没变，这个 URL 的字节已经定死，浏览器可以长期缓存 —— 重复打开页面时这张图一次网络请求都不发。版本号对不上（源文件刚被改写）或没带时，仍按每次重新验证处理，不会给出陈旧内容。

原图和视频在没有 `If-None-Match` 时支持 `If-Modified-Since`，按文件修改时间的秒精度返回 304，并保留 ETag、Last-Modified 与缓存策略。两者同时出现时以 `If-None-Match` 为准；ETag 未命中不会被时间条件再次判为 304。304 不携带媒体字节，客户端仍可复用已验证的内容。

4xx 响应（视频 `video_cover_missing` 404、源文件不存在等）**不**带 ETag —— 4xx 状态本身是临时的（cover 抽帧后变 200），不能让浏览器把 404 缓存住。

服务端在以下事件时 ETag 必然变化（缓存自动失效）：

- 源文件 `mtime` 变化（修改、覆盖、抽取新封面）
- 源文件 `size` 变化
- 渲染算法版本变化（缩放算法、JPEG 质量或档位集合调整）
- 渲染档位宽度变化（同一个 URL 带不同 `w` 即是不同产物）
- 视频经转码后由转码缓存文件代替原文件，ETag 派生的是实际发送文件
- 视频经 faststart remux 后同上

## 健康与配置

### `GET /api/health`

LAN 模式下未认证响应只包含 `status` 与 `accessMode`，避免公开根 ID 和运行时指纹。local 模式或 LAN 已认证请求还返回版本、Go 版本、goroutine 数、脱敏根 ID 和能力位；`mediaRoots` 中只包含 `r_` ID。

### `/api/auth/session`

- `GET`：返回 `{ "authenticated": true|false, "mode": "local|lan" }`，不返回凭据。
- `POST`：body 为 `{ "token": "..." }`，成功后设置 8 小时、`HttpOnly`、`SameSite=Strict`、`Path=/api` 会话 Cookie。也可用 `Authorization: Bearer <token>`。
- `DELETE`：删除当前服务端会话并清理 Cookie。

轮换 `accessToken` 后，用旧令牌签发的会话立即失效。前端只把令牌提交给会话端点，不写入 URL、localStorage 或业务 store。

认证请求体最大 1 KiB，令牌最大 256 字符；同一来源 5 分钟内超过 8 次失败返回 `429 too_many_auth_attempts`。正确令牌不会被失败计数锁死，并会清理该来源计数。

### 批量收藏与漫画未读重置

- `POST /api/favorites/batch` 请求 `{resourceIds:[资源ID],action:"add"|"remove"}`，一批 1–1,000 项；ID 可以是相册、集合或 `smart:<tag>`，整批校验并去重，返回 `{favorites:[当前完整收藏ID],updated:实际变化数}`。非法请求返回 `400 invalid_favorites_batch`；添加后超过既有 500 项收藏上限返回 `400 favorite_limit`，不裁掉原有收藏。一次锁内合并并只落盘一次。
- `DELETE /api/activity/batch` 请求 `{albumIds:[相册ID]}`，一批 1–1,000 项，返回 `{deleted:实际删除的漫画活动数}`。非法请求返回 `400 invalid_activity_batch`；不存在的活动幂等忽略，只重置图片阅读活动，保留视频播放位置，整批一次原子落盘。
- 批量标记已读复用 `PUT /api/activity/batch`。前端固定选择清单，先查询所选相册的当前属性和图片总数，仅提交非空漫画相册；集合、标签与照片不参与已读操作。

### 本机状态备份与恢复

三个端点均经过现有访问门禁与回环限制，响应 `Cache-Control: no-store`，错误不包含底层文件路径。

- `GET /api/admin/state/export` 下载 v1 JSON：`version`、`exportedAt`、`favorites`、`history`、`preferences`、`activities`、`covers`、`picks`、`people`、`smartAlbums`。`preferences` 仅为服务端偏好字段；`covers` 每项为 `{albumId,itemId}`。`smartAlbums` 只保存智能分组的自定义名称与隐藏状态，不含成员清单或分析产物。不含配置、令牌、扫描缓存或浏览器本机阅读偏好。当前库无法解析的旧封面不导出，`unresolvedCovers` 报告数量，恢复目录后可再次导出。
- `POST /api/admin/state/import/preview` 请求 `{backup}`，返回 `versions`、`libraryRevision`、`ready`、分类 `counts`、`missing` 与 `skippedCovers`。未知字段、损坏 JSON、非 v1 版本、非法或重复 ID 均返回 `400 invalid_state_backup`。设置页文件上限 32 MiB，接口含 JSON 包装上限 34 MiB，超限返回 `413 state_backup_too_large`。
- `POST /api/admin/state/import` 请求 `{backup,categories,versions,libraryRevision}`；类别为 `favorites/history/preferences/activities/covers/picks/people/smartAlbums`。`versions` 来自预览，是当前状态摘要，不是授权凭据。相关状态变化返回 `409 state_changed`；库变化或恢复封面时库未就绪返回 `409 library_not_ready`，均需重新预览。

覆盖前先在 `state/backups/` 保存同格式的恢复前 JSON 与仅服务端可见的完整内部封面映射；创建失败时不写入任何类别。收藏、历史和偏好共享文件，在一次锁内合并提交并保留未选类别；随后依次恢复活动、封面与精选，每个文件原子落盘。精选单独一个类别：恢复精选不动收藏，恢复收藏也不动精选。响应 `{completed,failed?,pending,code?,skippedCovers}`，失败后停止后续类别。已经完成的写入不因其他类别失败回滚，客户端不得自动重放恢复请求。

失效收藏、历史与活动保留供原有清理功能处理；封面须通过当前根、链接组件、相册成员与普通文件校验，失效项跳过。偏好中的 `maxRecent` 若会裁剪未选历史，或所选历史超过当前/所选偏好上限，返回 `400 history_limit_conflict`，需选择匹配的历史与偏好，不能静默丢失记录。首版适用于相同媒体根身份和相对路径，暂不提供目录迁移映射。

### `GET /api/config` / `PUT /api/config`

读取或更新 `config.yaml`。与下文的目录选择接口同属允许处理绝对路径的本机配置管理例外，只接受服务端回环地址请求；远程请求返回 `403 local_access_required`。

可更新字段：`mediaRoots`、`host`、`port`、`accessMode`、`accessToken`、`cacheDir`、`thumbCacheSize`、`cacheMaxAgeDays`、`cacheMaxSizeMB`、`ffmpegPath`、`allowOsOpen`、`staticDir`、`skipHidden`、`excludePatterns`、`systemFiles`。`accessToken` 永不在 GET/PUT 响应中回显，只返回 `accessTokenConfigured`。

`mediaRoots` 的每个条目同时携带目录路径与它的内容属性：`{ "path": "E:\照片", "kind": "photo" }`。`kind` 只有 `photo` 与 `comic` 两种且互斥，决定该目录里的相册与集合按哪种方式浏览、归入哪个工作台。条目写成映射但省略 `kind` 时按 `photo` 处理；非法 `kind` 返回 `400 invalid_config`。只写一个路径字符串的旧写法不再支持，启动时直接报错指出新写法。属性可热更新：它决定「相册用什么方式打开」与列表归属，保存后与路径变更一样触发自动扫描。

`mediaRoots` 相对进程 CWD 绝对化、清理路径分隔与 `.`、去空并保序去重，响应和写回 YAML 均使用规范化后的路径，保留首次出现的大小写。Windows 比较时忽略大小写，其他平台区分大小写；不通过解析符号链接或 junction 合并不同路径。仅增加等价写法、重复项或调整顺序时，`mediaRootsChanged=false`，保留现有媒体库、revision 和有效扫描缓存。

媒体根配置保存成功后，若规范路径或内容属性发生变化，服务端取消旧 generation、清库并启动最新非空根的扫描；根顺序和等价路径调整不触发扫描，空根只清库。`PUT /api/config` 成功响应增加可选 `scanId` 与 `scanStartError`：`scanId` 可交给现有 SSE 进度接口；`scanStartError=scan_start_failed` 表示配置已保存但自动扫描未能启动，可手动重试，不能将其当作配置保存失败重放。扫描属于进程生命周期，不随保存请求断连取消。

`host`、`port`、`cacheDir`、`ffmpegPath` 和 `staticDir` 修改后需要重启；`accessMode` 与 `accessToken` 可热更新，其中 LAN 令牌必须是 32-256 个无空白字符。渲染图的档位阶梯是固定实现约定（320/640/1280/1920/2560/4096），不可配置。LRU、保留天数和 `allowOsOpen` 可热更新，媒体根变更自动触发扫描，扫描排除规则在下一次扫描生效。

`cacheMaxSizeMB` 为整数 MiB，0～1048576，默认 10240；0 不限制容量。与 `cacheMaxAgeDays` 一起在下一轮自动维护生效，无需重启。启动时及每小时检查一次，只删除派生目录中的完整缓存文件；十分钟内的新文件与临时产物保留，因此容量是软上限。状态数据不参与清理。

## 图像库与扫描

### `POST /api/scans`

启动后台扫描，返回 `{ "scanId": "...", "reused": false }`。已有活动任务时不会重复扫描，返回相同 ID 和 `reused: true`。

### `GET /api/scans/:scanId/events`

订阅扫描事件。事件名为 `pending`、`running`、`complete`、`cancelled` 或 `error`；`currentPath` 仅包含根别名和相对路径。

`pending` 和 `running` 都保持连接，只有终态或通道关闭才结束正常推送；空闲期间每 15 秒发送 `: keep-alive` 注释心跳，心跳不包含业务事件。写入或刷新失败后释放当前订阅，不取消扫描任务或其他客户端的订阅。

重新连接会先收到最新事件快照，保留原事件的进度、阶段、已发现数量、`elapsedMs` 与 `libraryRevision`（如有）；已结束任务返回原始终态后关闭连接，不将取消或失败进度强制改为 100%。内部扫描错误仍只公开机器可读的错误码（`scan_failed`、`root_missing`、`root_not_dir`、`root_unreadable`、`root_changed`），界面据此翻译成中文说明；未知或已过保留期的任务返回 `404 scan_not_found`。

`albumsFound` 累计本轮所有根中已发现的相册，包含本目录媒体视图，切换根目录不会清零。`progress` 为不回退的预估百分比，不代表剩余文件数或耗时：根目录等分读取阶段 0–95% 的预算，整理阶段为 99%，快照成功发布后的 `complete` 为 100%。取消或失败沿用最后一次有效事件的进度、相册数、阶段和相对路径，不发布新的媒体库 revision。

扫描启动时记录各根目录身份，并在各根读取前后、整理后和提交前复核可读性与身份。检查发现根目录消失、不可读、变为文件或被新目录替换时，发送 `error`（`error` 为对应错误码，`currentPath` 给出媒体根别名，不含绝对路径），保留旧 manifest、revision 和磁盘扫描缓存，不发布部分根结果。可读的空根合法；根仍可用时，普通子目录读取失败继续作为 `directory_unreadable` 告警。

父子目录可同时配置为根，两个来源均保留。父根遍历时跳过单独配置的子根，由子根独立扫描；相册、集合及 `sourceRoot` 归属于最具体的根，根顺序不影响归属与资源 ID。子根自身由根节点表示，集合统计只计入根下的集合，目录分页不重复展示子根包装层或相册。SSE 的 `currentPath` 同样使用最具体根的别名和相对路径；内部显式 `MaxDepth` 按各根独立计算，委派给子根不产生跳过告警。

显式配置的符号链接或 Windows junction 目录可作为独立根；媒体请求与扫描进度共用最具体根的匹配规则，根的排列顺序不影响访问。该根本身是授权边界，其内部未单独配置的链接仍拒绝访问；移除链接根后，父根不继续授予链接目标访问权。扫描遇到未配置的链接时返回 `symlink_skipped` 告警，即使链接名带图片或视频扩展名也不收录为媒体。目录选择器仍返回解析链接后的真实路径，手动填写链接根沿用现有路径规范化规则。

### `DELETE /api/scans/:scanId`

取消扫描。取消信号会终止目录读取，取消后的任务不得写入图像库缓存。

扫描结果可包含 `warnings`：每项只有稳定 `code`、根别名/相对 `path` 和用户可读 `message`，不会暴露绝对路径。混合目录中的“本目录媒体”相册带 `virtual: true`，其相册 ID 与集合 ID 不同，但二者解析到同一真实目录。`collection.albumCount` 统计全部后代相册。

虚拟相册的 `name` 恒为“本目录媒体”（区分相册类型的语义常量），`displayName` 是归属目录，另带 `location`：归属目录相对所属媒体根的路径，用斜杠分隔，例如 `2020年`、`2011年/10.1一号公馆`；根目录自身的散图用根目录名。`location` 是这些相册在未读/最近等扁平列表里的唯一可辨识标识，搜索也按它命中；普通相册没有该字段。

扫描收录的媒体格式由服务端扩展名白名单决定（图片：jpg / jpeg / jfif / png / gif / bmp / webp / tiff / tif / heic / heif；视频：mp4 / m4v / webm / mov / mkv / avi / 3gp）。目录里只要有受支持的媒体就会生成相册；此前 3GP 不在白名单里，整目录都是 3GP 的文件夹（例如「萍乡中学/录像」）在应用里完全看不到。浏览器放不了的容器（mkv / avi / 3gp）一律走服务端转码，不按码流判断。

相册同时返回 `date`、`dateSource` 与 `datePrecision`。`dateSource` 取值为 `filename` / `folder` / `modified`，服务端按该顺序降级；`datePrecision` 为 `day` / `month` / `year` / `unknown`。`filename` 是从文件名推断的拍摄时间（`IMG_20240101_105902.jpg`、`2024-01-01`、`2024年10月1日` 这类写法），不读 EXIF；一本相册取其中出现次数最多的那一天（并列取较早的）。`folder` 只接受 `YYYY`、`YYYY-MM`、`YYYY-MM-DD`、`YYYYMM`、`YYYYMMDD` 或严格的 `YYYY/MM`、`YYYY/MM/DD` 路径分段，不会从任意名称子串中猜测。相册级 `date` 是代表值，不能当作相册内每张媒体的拍摄日期；只有年份或年月时，客户端应按 `datePrecision` 降低显示精度。集合与相册一样带 `date` / `dateSource` / `datePrecision` / `modTime`：集合的日期是后代相册拍摄时间的代表值（按媒体数加权取众数），没有拍摄时间时退回目录日期或目录修改时间。

相册还带 `contentSignature`：这本相册里媒体文件内容（大小与纳秒修改时间）汇总出的指纹。它区分「目录结构变了」与「文件内容变了」——原地覆盖一张照片时文件清单与目录修改时间都没变，只有这个指纹会变。客户端不需要解释它，只把它当作相册内容是否变过的判据。

媒体库浏览只使用下列 revision 分页接口。除 `/api/library/manifest`、
`/api/library/nodes/query`、`/api/tags/query` 与 `/api/albums/:albumId/media` 外，
它们都接受必填的 `kind` 查询参数，取值 `photo` / `comic`：

- `GET /api/library/manifest`：返回根列表、扫描时间和相册/集合/标签/告警统计，不包含目录树或媒体数组；`warnings` 最多返回前 100 条脱敏告警详情，完整数量见 `statistics.warningCount`。`statistics.albumCount` 恒为全库相册总数，另带 `photoAlbumCount` 与 `comicAlbumCount` 两个按属性拆分的计数——库规模不随工作台模式跳变。集合同理：`collectionCount` 恒为全库集合总数，另带 `photoCollectionCount` 与 `comicCollectionCount`。
- `GET /api/library/activity-summary`：返回当前 revision 的 `albumCount` 与 `unreadCount`，供常驻导航显示未读 badge；不返回相册清单或活动详情。两个计数都收敛到 `kind` 指定的属性。
- `GET /api/library/dashboard`：返回首页所需的 `albumCount`、`unreadCount`、最多 6 本 `unread` 相册摘要与全部 `inProgress` 阅读摘要；不返回全量相册列表。每条在读摘要的 `pageCount` 始终以当前扫描结果为准。阅读进度只属于漫画工作台：`kind=photo` 时 `inProgress` 恒为空。
- `GET /api/library/unread?limit=60&cursor=...`：分页返回尚未翻开过的相册摘要；已读和在读相册不会传输。有图片的相册以漫画阅读活动判定，纯视频相册以视频播放活动判定（没有阅读活动可依）。未读只统计漫画目录的相册：`kind=photo` 时恒为空。
- `GET /api/library/recent?limit=60`：返回该属性下最近加入的相册摘要，按业务日期倒序（`date` 缺失时退回 `modTime`）。照片工作台不记录浏览进度，没有「继续阅读」可言，这个接口是它与漫画侧对称的入口，也是收藏空态的推荐来源。不分页：`total` 是该属性下的相册总数，`items` 至多 `limit` 条。
- `GET /api/library/on-this-day?month=11&day=07&limit=20&fallback=1`：往年同一天（同月同日）拍过照的相册。`month` / `day` 缺省时取服务端当天；只认拍摄日期（`dateSource=filename`），没有拍摄时间的相册不在其中；今年的照片不算「往年」。同一本相册只出现一次，取它最近的一次命中。每项在相册摘要之外多给 `matchedDate`（命中的那一天，`YYYY-MM-DD`）—— 相册自己的 `date` 是「最有代表性的那一天」，未必等于命中的那一天。每项还可能带 `photo`：真正拍于那一天的那一张照片（媒体字段 + `date`），日期证据同样来自文件名推断；服务端给不出这一张时该字段缺省，客户端不应拿相册封面冒充「那天拍的那张」。`fallback=1`：所问的月日往年没有拍过照时，改返回离这一天最近的、往年确实拍过照的那几天（按日历上的远近排，跨年也算近，同样近的按月日定次序）。每项仍带自己的 `matchedDate` 与 `photo`，客户端据此说清摆的是哪几天 —— 退回的日子不能冒充成「那天」。首页用这个参数：拍摄日期是从文件名推断的，稀疏得很，不退回的话大多数日子里这一段会整个消失。
- `GET /api/library/:rootOrCollectionId/children?limit=60&cursor=...`：分页返回直属相册与子集合摘要。相册与集合都继承所属目录的属性，因此都参与 `kind` 过滤；属性不匹配的目录返回空页。集合摘要的 `albumCount` 恒为全部后代。
- `GET /api/albums/random?scope=unread&count=3`：随机返回相册摘要列表；只在该属性的相册里抽取，`scope=unread` 时进一步只从未保存阅读活动的相册中抽取。`count` 缺省 1、范围 1–12，越界返回 `400 invalid_random_count`；抽出的相册互不相同，候选不足 `count` 时返回全部。没有匹配相册返回 `404 no_matching_album`。
- `GET /api/albums/:albumId/media?limit=60&cursor=...`：按统一自然顺序返回媒体；`index` 是相册内总序号，`kindIndex` 是图片或视频各自序号。图片项另带 `width` / `height`（原始像素宽高，未知时为 0），照片墙据此按真实宽高比排布，不必在浏览器里逐张探测。媒体流与工作台模式无关。媒体项另带 `picked: true`，表示这张照片在精选里（精选是照片级的用户数据，见「精选」一节）。
- `GET /api/albums/:albumId/media` 另接受一组筛选参数。**筛选作用在整本相册的数据上**，不是前端已经加载的那几页：服务端先把条件落成「相册成员 → 是否命中」的判定，再按相册的自然顺序分页，因此结果总数、翻页与大图浏览顺序始终是同一件事。

  | 参数 | 含义 |
  | --- | --- |
  | `from` / `to` | 拍摄时间的日历月区间（`YYYY-MM`），左闭右闭。拍摄时间取 EXIF 的可信值（年份早于 1990 或晚于当年的不算）。 |
  | `personId` | 只保留出现过这个人物的照片（人物分组 ID）。 |
  | `adcode` | 只保留落在这个行政区（含其下级）里的照片（六位区划码）。 |
  | `picks` | 精选口径：`only` 只看已精选，`none` 只看未精选。 |
  | `scene` | 画面口径：`groupPhoto` 只看合照，`similar` 只看属于相似组的照片。 |
  | `collapse` | `1` 折叠相似组：墙上只留每组的代表照片。 |
  | `expand` | 展开某一组（分组 ID）：它的成员不再折叠，聚到代表照片后面就地摊开。给了它就等于 `collapse=1`。 |

  条件可组合。**视频不参与分析类筛选**：没有拍摄时间、位置与人物，混进结果只会给出一批「说不清为什么在」的条目；没有任何分析类条件时视频照常返回。

  响应除分页字段外另给：`filtered`（这一页是筛选后的结果）、`albumTotal`（这本相册的媒体总数）、`videoTotal`（视频数）、`photoTotal`（这一页里照片的张数，不含视频）、`unresolved`（因缺少依据而没能参与筛选的照片数：`captureTime` / `location` / `face` 三个分项与去重后的 `total`）、`grouped` 与 `groupedGroups`（折叠后藏起来的张数与组数）。

  换了一组条件后旧游标立即失效（游标作用域含筛选条件），返回 `400 invalid_cursor`。参数不合法返回 `400 invalid_album_filter`。

- 媒体项另带 `similarityGroup`：这张照片所属的相似组。`id` 是分组标识，`kind` 是 `exact` / `near` / `burst`，`size` 是组内照片总数（全库口径），`albumSize` 是组内落在本相册的张数，`shown` 是折叠时留在墙上的那张，`albumHidden` 是折叠后藏起来的张数。没有分组时这个字段缺省。

- `GET /api/albums/:albumId/filters`：返回这本相册里**真实可用**的筛选条件。响应为 `{ "ok": true, "revision": 42, "facets": {...} }`，`facets` 含：

  | 字段 | 内容 |
  | --- | --- |
  | `total` / `videos` | 这本相册的照片数与视频数。 |
  | `time` | `available`（能不能用）、`reason`（不能用的原因，中文）、`months`（有照片的月份与张数）、`analyzedCount`、`unresolvedCount`。 |
  | `people` | `available`、`reason`、`items`（这本相册里出现过的人物：ID、名字、张数、是否已确认）、`analyzedCount`。 |
  | `places` | `available`、`reason`、`items`（区划码、地名、层级、张数）、`locatedCount`。 |
  | `picks` | `pickedCount`（这本相册里已精选的照片数）。 |
  | `groupPhotos` | `available`、`reason`、`count`（合照张数）。 |
  | `similarity` | `available`、`reason`、`groupCount`、`photoCount`、`stale`。 |

  每个维度都按这本相册算：别的相册里有的东西这里不出现。缺分析结果时写清原因（还没跑分析，还是跑了但这本相册里确实没有），不摆一个点下去空无一物的入口。
- 图片项还可能带 `undecodable: true`：这个文件解码不出来 —— 扩展名说是 JPEG，内容却不是，或者像素数据是截断的。判定有两个来源：读图片头就失败（当场判定），以及渲染时整张解码失败（补记，随文件版本走，文件被替换后判定作废）。需要服务端转换的格式（HEIC/HEIF/TIFF）不算坏文件，不带这个标记。界面据此显示「无法解码」。
- `POST /api/library/nodes/query`：body 为 `{ "ids": ["a_...", "c_..."] }`，按输入顺序批量解析相册/集合摘要；单批最多 500 项，失效 ID 返回在 `missing` 中。直达链接、收藏与最近浏览都靠它解析摘要，**不受工作台模式影响**。
- `GET /api/tags?limit=60&cursor=...`：分页返回标签摘要。每个标签的 `albumCount` 按 `kind` 指定的属性重算，该属性下没有相册的标签整个不出现。
- `POST /api/tags/query`：body 为 `{ "names": ["共同", "连载"] }`，按输入顺序批量解析标签摘要；单批最多 500 项。它**不按工作台属性过滤**，而是同时给出 `photoAlbumCount` 与 `comicAlbumCount`，客户端据此区分「这个标签失效了」和「它只属于另一侧」。库里根本没有的标签名进 `missing`。
- `GET /api/tags/:tag/albums?limit=60&cursor=...`：分页返回标签下的相册摘要。`tag` 按单个 URL 路径段编码，服务端只解码一次，支持中文、空格、`+`、`%` 及字面 `%xx`；非法百分号编码返回 `400 invalid_tag`，解码后为空返回 `400 missing_tag`，不存在的标签返回 `404 tag_not_found`。

`kind` 过滤全部命中：相册与集合按其目录属性归属，标签则按「该属性下是否还有相册」判断——只含漫画的标签不出现在照片工作台的结果里。缺失或非法取值返回 `400 invalid_kind`。

`limit` 默认 60、最大 200。响应统一为 `{ "ok": true, "page": { "revision": 42,
"items": [], "total": 0, "nextCursor": "..." } }`；manifest 和分页响应都带
`ETag: W/"library-<revision>"`。游标带签名并绑定资源作用域与 revision，篡改或跨资源
复用返回 `400 invalid_cursor`，扫描发布新版本后返回 `409 stale_cursor`，客户端应丢弃
已合并页面并从 manifest 重试。**切换工作台模式后旧游标一律失效**（作用域含目录属性），
客户端应从第一页重新拉取。

节点摘要不携带媒体数组。相册摘要通过 `tags: string[]` 返回目录名解析出的全部标签，
不再提供单标签别名字段。相册摘要的 `parentName` 是它直接上级集合的名字，也就是
「所属系列」——漫画目录里一连载多卷时，它标出这一卷属于哪部作品；根目录下的相册
没有上级集合，该字段为空。节点摘要的 `parentId` 是同一件事的另一种形式：直接上级
集合的资源 ID。顶层集合与根目录下的相册没有上级集合，该字段为空；客户端据此
逐级向上解析，拼出「存照 / 萍乡中学 / 3班running man」这样的面包屑。散图
（虚拟相册）是某个目录里的散落媒体，与同名集合同处一个目录，因此它的上级是那个
集合本身而不是集合的父目录。作品索引的索引项取自根目录下的集合（集合的成员由服务端
聚合成 `albumCount`）—— 那一面索引现在住在书架里。集合摘要的 `albumCount`、`imageCount`、`videoCount`、
`mediaCount` 和 `folderSize` 均包含所有后代，`childCount` 仍只表示直属子项数量。
相册摘要的 `hasCustomCover` 为 `true` 时表示当前 revision 已应用用户设置的人工封面；
失效的覆盖记录不会出现在此字段中。

节点摘要的 `contentKind` 是该节点的内容属性（`photo` 照片墙 / `comic` 漫画阅读器），
完全继承自所属媒体根的属性。属性决定点击相册后进入照片墙还是阅读器，也决定它
出现在哪个工作台；它与相册里是图片还是视频无关，也不按图片数量推断。
`/api/library/manifest` 的根摘要同样带 `contentKind`。

### `DELETE /api/library`

取消活动扫描，使它的提交令牌失效，并清除内存资源快照与磁盘扫描缓存；不会立即发起新扫描。

### `GET /api/library-sync`

返回自动发现文件变化的开关与运行状态。

```json
{
  "enabled": true,
  "autoAnalyze": false,
  "running": true,
  "degraded": false,
  "watchedRoots": 1,
  "watchedDirs": 109,
  "maxWatchDirs": 10000,
  "pendingChanges": 0,
  "pendingAnalysis": 0,
  "lastEventAt": "2026-11-18T17:11:48Z",
  "lastVerifyAt": "2026-11-18T17:11:17Z",
  "lastSyncAt": "2026-11-18T17:11:48Z",
  "lastDetected": 8,
  "lastUpdated": 5,
  "lastFailed": 0,
  "lastError": "",
  "libraryRevision": 42
}
```

- `running`：监听器已启动并在接收事件。`degraded` 表示监听不可靠（事件溢出、权限不足），此时由定期校验兜底；某个媒体根读不到（离线磁盘、断开的网络共享）不算降级，其余根照常工作。
- `watchedDirs` / `maxWatchDirs`：已登记的监听目录数与上限。Windows 上每个目录占一个句柄与一块事件缓冲区，因此上限固定，内存与句柄有界。
- `lastDetected` / `lastUpdated`：上一次真正改动图库的同步里，检测到的变化条目数与改动索引的资源数量。图库结构没变时（例如只是目录被碰了一下）不发布，也不覆盖这两个计数。
- `lastVerifyAt` 是最近一次定期校验（全量扫描）的时间，`lastSyncAt` 是最近一次改动图库的增量同步的时间 —— 两个计数与它描述的是同一件事。`lastError` 是机器可读的失败原因：`event_overflow`、`watch_failed`、`watcher_start_failed`、`root_unavailable`、`incremental_failed`、`verification_failed`；界面据此翻译成中文。
- `libraryRevision` 与媒体库接口返回的 revision 一致：它一变，界面就重新拉数据。

### `PUT /api/library-sync`

修改开关。body 为 `{ "enabled": true, "autoAnalyze": false }`，两个字段都缺省视为「不改」，不能省略整段（否则返回 `400 invalid_library_sync_body`）。返回更新后的状态，结构同 `GET`。

- `enabled`：打开后监听已配置的媒体根，文件新增、删除、移动后增量更新图库；关闭后只保留设置，不再监听磁盘。开关保存在 `state/library_sync.json`。
- `autoAnalyze`：打开后，图库更新时为变动的照片排分析任务（按模块排队，复用任务中心）；关闭后只更新图库，不排分析任务。

## 媒体分析任务与地点相册

### `GET /api/ai/jobs` / `POST /api/ai/jobs`

读取任务历史、活动任务、等待队列与每日计划；启动请求为 `{ "type": "metadata" | "embedding" | "ocr" | "face" | "similarity", "mode": "full" | "incremental", "albumId"?: "a_…" }`。不传 `albumId` 时分析当前库；传入时只分析该照片相册内的图片，非照片相册或失效 ID 返回 `400 invalid_analysis_album`。全量分析当前范围内的图片，增量分析新增、修改或模块版本变化的图片。`metadata` 读取 EXIF/GPS；`embedding` 使用本机 Chinese-CLIP 生成语义向量；`ocr` 使用 RapidOCR 识别文字；`similarity` 在本机提取照片的内容指纹、感知哈希与质量指标，用于发现重复、裁剪压缩过的副本与连拍（该模块不需要本机 Python 依赖与权重）；`face` 使用当前选定的人脸模型检测并生成人脸特征：`quality-v2` 是 YuNet + SFace（128 维），`buffalo_m` 是 SCRFD + ResNet50（512 维）。任务快照中的 `faceModel` 固定记录创建任务时使用的模型。两种模型的每张照片分析记录分别持久化；切换后会加载该模型已有记录，增量只补齐该模型缺失或过期的照片。人物索引和人工修正同样按模型隔离；人物相册与智能相册人物维度始终使用当前选择模型的数据，切换后不会展示另一模型生成的缓存结果。模型可在任务中心切换，见 `PUT /api/ai/jobs/face-model`。embedding、OCR 与人脸三类任务需要对应本机 Python 依赖与权重，缺失时返回 `503 ai_runtime_unavailable`、`503 ai_model_missing` 或 `503 ai_module_unavailable`；相似照片特征任务只用本机标准库，不受这些条件影响。已有活动或等待中的任务时返回 `409 analysis_job_active`；模块类型或模式无效时返回 `400 analysis_start_failed`。响应含任务快照与 `reused`。

任务快照的 `jobs` 按创建时间倒序提供任务记录，`active` 是当前执行或暂停的任务，`queue` 是按执行顺序排列的等待任务 ID，不包含 `active`。任务记录包含等待队列任务以及所有终态记录。队列 ID 与任务状态会一起持久化到 `state/ai_jobs.json`；旧状态文件缺少 `queue` 时会按待执行任务的创建顺序恢复，服务重启时未完成的当前任务会插回队首续跑。

任务状态为 `pending`、`running`、`paused`、`completed`、`failed`、`cancelled`。快照包含阶段、总数、已处理/跳过/失败/完成数、检查点、耗时、速度、开始/结束时间及错误项；人脸任务另含 `faceModel`。`stage` 会报告 GPU 环境检查、等待媒体库、整理分析清单、准备模型与首批推理，以及后续的模块批量推理。首批阶段可能包含模型冷启动。任务的 `computeDevice` 是创建时记录的 `cpu` 或 `gpu`：元数据与相似照片特征始终使用 CPU，其他模型任务默认强制使用 GPU；关闭 GPU 设置后新任务改用 CPU，已排队任务不变。旧状态里的未完成任务若没有设备记录，恢复时按当前 GPU 设置补录设备，元数据任务仍使用 CPU。设备不可用或 GPU 推理失败时，任务以 `failed` 结束，并在 `errorCode` 与 `error` 中记录原因。错误项包含资源 ID、根目录别名下的相对图片路径、稳定错误码、脱敏原因和时间；不返回文件系统绝对路径。任务在后台按 32 张一批提交，重启后自动恢复运行中任务。

快照里另有几个按持久化计数推导的进度字段，以及两份产出统计：

- `planned`：本次任务实际要处理的张数。`total` 是整库规模，增量任务里绝大多数文件已经是最新的；`planned` 才是这次真正要干的活。它与 `GET /api/ai/jobs/estimate` 算出来的增量张数是同一个口径 —— 两边用同一条判据（大小、纳秒修改时间、模块版本）。
- `completed`：已处理张数（成功与失败都算）。
- `estimatedRemainingMs`：运行中任务的预计剩余毫秒。根据任务墙钟耗时与已完成图片推算，包含清单整理和首次模型加载，因此小任务或冷启动时较粗略。只在 `running` 时给出；暂停时耗时仍在增长、速度已失真，因此返回 0。队列、暂停与终态同样返回 0。
- `speedPerSecond`：每秒实际处理张数，不含被跳过的文件（增量任务的 `done` 从跳过数起步，按它算速度会在任务开头虚高）。
- `results`：按处理结果分类的计数。元数据使用 `parsed`、`no_exif`、`unsupported`、`failed`；OCR 使用 `recognized`、`no_text`、`failed`；人脸使用 `faces_found`、`no_faces`、`failed`；向量使用 `indexed`、`failed`。每组键的计数和等于 `completed`。
- `fields`：按字段统计的产出计数，键包括 `exifTime`、`camera`、`gps`、`embedding`、`ocrText`、`faces`、`similarity`。只统计实际取得内容的图片，不报告空结果。

### `POST /api/ai/jobs/sequence`

请求为 `{ "mode": "full" | "incremental", "albumId"?: "a_…" }`，一次创建所有已就绪模块的任务，并按固定顺序加入既有任务队列。全库任务依次执行 metadata、embedding、OCR、face、similarity；传入照片 `albumId` 时仅排入 metadata、embedding、face、similarity，并且每项只处理该相册图片。任务逐项执行，单项结束后自动启动下一项；未安装或运行环境未就绪的模块列在 `skippedModules`，其余任务仍会排队。响应包含有序 `jobs` 与 `{type,name,reason}` 形式的跳过清单。队列已有活动或待执行任务时返回 `409 analysis_job_active`；没有任何可运行模块时返回 `503 ai_module_unavailable`。

### `GET /api/ai/jobs/estimate`

空闲时的规模与耗时核算。只读：不创建任务，不写状态文件，不碰队列。

响应给出整库图片数，以及每个分析模块在增量与全量两种口径下「本次要处理多少张」和「预计要多久」。

```json
{
  "ok": true,
  "estimate": {
    "generatedAt": "2026-11-12T02:10:11.482Z",
    "libraryRevision": 42,
    "libraryReady": true,
    "totalImages": 12345,
    "modules": [
      {
        "type": "metadata",
        "name": "照片元数据",
        "installed": true,
        "available": true,
        "version": "metadata-v1",
        "incremental": { "count": 320, "estimatedDurationMs": 45000, "sampleCount": 3, "sampleImages": 900 },
        "full": { "count": 12345, "estimatedDurationMs": 1740000, "sampleCount": 3, "sampleImages": 900 }
      },
      {
        "type": "face",
        "name": "人脸识别",
        "installed": true,
        "available": false,
        "reason": "people_analysis_disabled",
        "incremental": null,
        "full": null
      }
    ],
    "sequence": {
      "incremental": { "count": 320, "estimatedDurationMs": 45000, "modules": ["metadata"] },
      "full": { "count": 12345, "estimatedDurationMs": 1740000, "modules": ["metadata"] }
    }
  }
}
```

字段含义：

- `generatedAt`：本次核算的完成时刻。核算是那个时刻的快照，之后文件再变就不再准了。
- `libraryRevision`：核算所依据的资源快照版本号；媒体库重新扫描后变化。
- `libraryReady`：媒体库是否已扫描完成。为 `false` 时计数都是 0，界面显示「媒体库尚未就绪」而不是「0 张」。
- `totalImages`：库内可分析的图片总数（只算图片文件）。
- `modules[]`：固定四个模块，顺序为照片元数据、向量索引、文字识别、人脸识别。
  - `installed`：模块已注册且运行环境就绪。
  - `available`：现在能不能启动 —— 已就绪且没有被人物分析开关锁住。
  - `reason`：不可用的原因，取现有词表（`python_runtime_unavailable`、`module_not_registered`、`people_analysis_disabled` 等）。
  - `incremental` / `full`：该模块在该口径下的核算结果；模块不可用时为 `null`。
- 口径块内：`count` 是本次真正要处理的张数；`estimatedDurationMs` 是预计耗时；`sampleCount` 与 `sampleImages` 说明这个耗时参考了几次历史任务、共多少张图。
- `sequence`：「按序启动全部任务」在两种口径下的合计，`modules` 列出参与的模块。

**张数口径**：核算与任务用同一条判据 —— 逐张 stat，比对字节大小、纳秒修改时间与模块版本，模块自己的结果有效性校验同样生效。因此增量张数就是任务开始后的 `planned`；全量张数等于 `totalImages`。

**耗时口径**：来自 `state/ai_jobs.json` 里已结束任务（`completed` 与 `failed`）的 `startedAt`、`finishedAt` 与实际分析张数，取每张耗时的中位数。同模块的历史不够可信时（版本变了、样本张数太少）逐层放宽；最近几次优先。**没有历史记录时 `estimatedDurationMs` 为 `null`**，不给默认速度，也不拿 0 假装算得出来。

两层 `null` 的区别：模块级的 `incremental: null` 表示该模块现在不可用（看 `reason`）；模式级的 `estimatedDurationMs: null` 表示模块可用但没有历史记录，估不出耗时。

错误码：

| 情况 | 状态码 | code |
| --- | --- | --- |
| 分析服务未装配 | 503 | `analysis_unavailable` |
| 核算超时（超大库） | 503 | `analysis_estimate_timeout` |
| 其它内部错误 | 500 | `analysis_estimate_failed` |

界面上的「本次规模」表、按钮上的张数与每日计划的预计工作量都来自这个接口；任务真正开跑后，界面上显示的是任务快照里的 `planned` —— 那才是事实。

### 等待队列管理

- `POST /api/ai/jobs/:jobId/move`：请求 `{ "direction": "up" | "down" }`，将等待任务移动一位，成功返回最新 `snapshot`。未知任务返回 `404 analysis_job_not_found`；任务不在等待队列或已到对应边界时返回 `409 analysis_queue_action_unavailable`；方向无效返回 `400 invalid_analysis_queue_request`。
- `POST /api/ai/jobs/:jobId/cancel`：取消活动任务，或从队列中取消等待任务。活动任务在当前批次结束后退出并保留已提交结果；等待任务立即变为 `cancelled`。
- `DELETE /api/ai/jobs/queue`：取消全部等待任务，不影响当前任务。响应 `{ "ok": true, "cancelledCount": number, "snapshot": ... }`。

### 任务记录管理

- `DELETE /api/ai/jobs/:jobId`：删除单条已结束任务记录。
- `DELETE /api/ai/jobs/history`：删除全部 `completed`、`failed` 和 `cancelled` 任务记录。

历史删除只移除 `state/ai_jobs.json` 中的任务日志，不会删除 `derived/metadata` 中可重建的分析批次、语义索引、OCR 搜索数据或人脸结果。不存在的任务返回 `404 analysis_job_not_found`；活动与等待任务不可删除，返回 `409 analysis_history_delete_unavailable`。批量删除响应含 `deletedCount` 与最新 `snapshot`。

`planned`、`completed`、`estimatedRemainingMs` 与速度都是快照派生值，不写入 `state/ai_jobs.json`；`results` 与 `fields` 是事实，随批次一并落盘，重启后按批次文件重放恢复。任务的 `checkpoint.offset` 与 `checkpoint.batch` 是最近已提交的位置；`recoveredAfterRestart=true` 表示服务重启后已从该检查点续跑（没有已提交批次时从任务起点重新开始）。用户手动暂停后等待继续不会设置此标记。

快照还带 `modules`：后端已知的全部分析模块及其安装情况，元素包含 `{ "type", "name", "installed", "version", "reason" }`。`type` 为 `metadata`、`embedding`、`ocr`、`face`；对 OCR 与人脸模块，`installed` 表示对应本机运行依赖和权重已就绪，缺失时可用 `reason` 诊断。`version` 只在已就绪时给出。客户端据此渲染模块清单，不再自行硬编码模块名。

### `GET /api/ai/jobs/:jobId` / `GET /api/ai/jobs/:jobId/events`

单项读取持久任务。SSE 事件名与状态一致；每条 `data` 为完整快照。`pending`、`running` 与 `paused` 保持订阅，终态事件（`completed`、`failed`、`cancelled`）后关闭。每 15 秒发送注释心跳；断开只释放订阅，不会暂停或取消任务。未知 ID 返回 `404 analysis_job_not_found`。

### 任务控制

- `POST /api/ai/jobs/:jobId/pause`：在当前批次原子提交后暂停。
- `POST /api/ai/jobs/:jobId/resume`：继续暂停或重启恢复的任务。
- `POST /api/ai/jobs/:jobId/cancel`：取消活动或等待任务；活动任务的已提交结果保留，未提交批次不写入，等待任务不再执行。
- `POST /api/ai/jobs/:jobId/retry`：从旧任务创建新历史项，只处理失败记录与未提交尾段；有其他任务活动时返回 `409 analysis_job_active`。

不存在的任务返回 `404 analysis_job_not_found`；状态不支持该操作返回 `409 analysis_action_unavailable`。

### `GET /api/ai/jobs/settings` / `PUT /api/ai/jobs/settings`

每日计划请求字段为 `{ "dailyEnabled": true, "dailyTime": "03:00", "dailyScan": true, "dailyModules": ["metadata", "ocr"], "dailySmartAlbums": true, "peopleEnabled": false }`。新安装默认开启每日扫描和智能相册刷新，分析模块默认选择 `metadata`；`peopleEnabled` 默认关闭。人脸任务使用当前保存的 `faceModel`，该选择同样用于每日增量分析。开启人物分析后才允许启动 `face` 任务，也可将其加入每日计划。关闭时会从计划模块中移除 `face`；若人脸任务仍在排队、运行或暂停，返回 `409 analysis_job_active`。时间格式为 24 小时 `HH:MM`；开启计划时至少选择扫描、智能相册或一个已安装的分析模块。未安装模块、没有任何已选任务或无效时间返回 `400 invalid_analysis_settings`。到时后按“扫描媒体目录 → 所选分析模块的增量任务 → 刷新所有照片相册的四个智能分组维度”顺序执行；扫描失败会停止后续步骤，未就绪的分析模块会跳过，其他可运行模块继续执行。计划会等待本轮分析全部结束后再刷新智能相册；任一已运行分析任务失败/取消，或有选中模块未就绪时，仍用已有结果刷新分组，但计划状态标记为 `failed`，错误码分别为 `analysis_failed` 或 `analysis_module_unavailable`，不会误报完成。智能相册刷新只使用本轮与已有的分析结果：时间/地点依赖 `metadata`，场景依赖 `embedding`，人物依赖已启用的 `face`；计划页会提示所选模块能支持的维度，并展示分析失败或未就绪状态，不会为未选维度隐式启动高耗时分析。设置响应还包含 `faceModel`、`gpuEnabled`、`lastScheduledDate`、`lastScheduledStatus`、`lastScheduledStage` 与安全错误码 `lastScheduledError`。服务错过计划日期后启动时补跑一次，同一天不重复执行；服务关闭期间错过计划时，会在下次启动后补跑。旧状态文件缺少 `dailyModules` 时按 metadata 恢复，缺少 `dailyScan` 或 `dailySmartAlbums` 时按开启处理，缺少 `peopleEnabled` 时按关闭处理，缺少 `gpuEnabled` 时启用 GPU；缺少 `faceModel` 时按 `quality-v2` 恢复。

### `PUT /api/ai/jobs/hardware`

请求为 `{ "gpuEnabled": true | false }`，持久化新任务的硬件偏好。默认开启；向量、OCR 与人脸任务强制使用 NVIDIA GPU，不自动切换到 CPU，GPU 不可用或推理失败时任务记录 `gpu_unavailable` 或 `gpu_inference_failed`。关闭后新建任务使用 CPU。元数据解析始终使用 CPU，修改偏好不会改变已排队任务。缺少布尔字段或 JSON 无效返回 `400 invalid_analysis_hardware`；保存失败返回 `500 analysis_hardware_update_failed`。

### `PUT /api/ai/jobs/face-model`

请求为 `{ "model": "quality-v2" | "buffalo_m" }`，保存新建人脸任务和每日计划使用的模型。只有模型权重已就绪时才能通过任务中心启动对应分析；任务快照保留创建时的模型。切换期间若人脸任务或每日计划正在运行，返回 `409 analysis_job_active`；不支持的模型返回 `400 invalid_face_model`。设置保存失败返回 `500 face_model_update_failed`；切换后重建当前人物索引失败会恢复原模型设置并返回 `500 people_index_unavailable`。模型状态通过 `GET /api/ai/semantic/status` 的 `faceModels` 返回，包含 `ready`、`version` 和可选错误码。quality-v2 使用 128 维特征，Buffalo_m 使用 512 维特征；两种向量空间严格隔离，不混合参与人物分组或人脸相似检索。切换会恢复该模型独立的人脸记录、人物索引与人工修正；目标模型尚无当前版本结果的照片会进入下次增量分析。

### `GET /api/ai/semantic/status`

返回本机 Python、PyTorch、CUDA/GPU、ONNX Runtime CUDA Execution Provider、Chinese-CLIP SHA256 校验、向量索引版本与覆盖率，以及 `modules.ocr`、`modules.face` 和逐项的 `faceModels.quality-v2` / `faceModels.buffalo_m` 状态。`runtimeReady` 表示 Chinese-CLIP 推理依赖可导入，`modelValid` 表示权重匹配固定 revision；`cudaAvailable` 与 `cudaExecutionProviderAvailable` 分别报告 PyTorch CUDA 和 ONNX Runtime CUDA 是否可用。关闭 GPU 强制设置时仍可使用 CPU。OCR 和两种人脸模型通过各自状态独立报告依赖与权重就绪情况，不受 Chinese-CLIP 权重缺失影响。`coverage` 按当前资源快照和有效文件指纹统计已索引数/照片数。

### `GET /api/storage/usage`

本机分析存储的占用接口，经过现有 API 访问门禁即可访问（局域网客户端认证后同样可用），响应设置 `Cache-Control: no-store`。

响应里的路径**一律相对缓存根目录**，不含任何绝对路径；绝对路径只由 `GET /api/storage/paths` 给出。

```json
{
  "ok": true,
  "usage": {
    "scannedAt": "2026-11-12T02:03:04Z",
    "durationMs": 26,
    "available": true,
    "cacheTtlSeconds": 30,
    "summary": { "modelBytes": 0, "modelFileCount": 0, "outputBytes": 0, "outputFileCount": 0 },
    "modules": [
      {
        "type": "embedding", "name": "向量索引",
        "modelDirectory": "derived/ai/models",
        "modelLocation": "cache",
        "modelFiles": [
          { "name": "clip_cn_vit-b-16.pt", "path": "derived/ai/models/clip_cn_vit-b-16.pt",
            "location": "cache", "sizeBytes": 0, "exists": true }
        ],
        "modelBytes": 0, "outputBytes": 0, "outputFileCount": 0,
        "outputs": [
          { "kind": "batches", "label": "批次结果", "path": "derived/metadata/embedding",
            "bytes": 0, "fileCount": 0, "available": true },
          { "kind": "vectors", "label": "向量索引", "path": "derived/ai/vectors",
            "bytes": 0, "fileCount": 0, "available": true }
        ]
      }
    ],
    "paths": {
      "relativeTo": "cacheRoot",
      "stateDirectory": "state", "jobsFile": "state/ai_jobs.json",
      "metadataDirectory": "derived/metadata", "aiDerivedDirectory": "derived/ai",
      "vectorDirectory": "derived/ai/vectors", "modelDirectory": "derived/ai/models"
    }
  }
}
```

- `modules` 按 `metadata`、`embedding`、`ocr`、`face` 固定顺序给出，与模块清单一致。
- `modelLocation` 为 `none`（无权重）或 `cache`（权重在缓存根目录内，`path` 相对缓存根目录）。OCR 权重位于 `derived/ai/models/ocr/`。
- `outputs[].kind` 为 `batches`（每次任务新增的批次结果）、`vectors`（向量分片）或 `index`（模块共享的索引）。人脸模块另含 `profiles[]`，分别报告 `quality-v2` 与 `buffalo_m` 的 `version`、`active`、模型权重和产物；产物包含各模型的批次目录、人物索引与人工修正文件。模块级数字是两套模型的合计。产物目录尚未产生时 `available=false`、`bytes` 与 `fileCount` 为 0。
- 照片元数据由 Go 内置 EXIF/GPS 解析器处理，没有独立模型权重；人脸存储按模型分别统计 YuNet/SFace 与 SCRFD/ResNet50 权重、任务批次、人物索引和修正状态。
- 占用统计带 30 秒内存 TTL，批次提交与人物分析结果清理后失效重算。

### `GET /api/storage/paths`

本机绝对路径接口，**仅允许回环访问**，并经过现有 API 访问门禁；响应设置 `Cache-Control: no-store`。非回环请求返回 `403 local_access_required`。

返回 `{ "ok": true, "paths": { "workingDirectory", "configFile", "cacheRoot", "stateDirectory", "jobsFile", "pythonEnvironment", "pythonExecutable", "modules": [{ "type", "name", "modelDirectory", "modelFiles": [{ "name", "path", "sizeBytes", "exists" }] }] } }`。

完整路径只用于运行服务的这台计算机上的显示，不应写入浏览器持久状态，也不向局域网客户端开放；局域网客户端改用 `GET /api/storage/usage` 的相对路径。

### `GET /api/ai/jobs/:jobId/output`

单次分析任务已提交批次的占用，经过现有 API 访问门禁即可访问，响应设置 `Cache-Control: no-store`。

```json
{ "ok": true, "output": {
  "jobId": "…", "type": "ocr", "batchSize": 32,
  "path": "derived/metadata/ocr/batches/…",
  "bytes": 0, "fileCount": 0, "available": true, "scannedAt": "2026-11-12T02:03:04Z"
} }
```

批次目录以任务记录里的模块类型与任务 ID 推导，不取自 URL。目录已被清理时 `available=false`、`bytes` 与 `fileCount` 为 0，但仍给出它本该在的相对路径。未知任务返回 `404 analysis_job_not_found`。

### `POST /api/ai/search`

语义检索使用 `text`，以图搜图使用 `resourceId` 或 multipart 上传的 `image`（最大 64 MiB）；三者最多选一种。可额外组合 `ocrText`（最多 200 字符）、`matchMode`、`albumId`、`year`、`adcode`、`personId`、`favoriteOnly` 与 `pickedOnly`。`matchMode` 可为 `all`（默认，同时提供语义和 OCR 条件时要求照片同时符合两者）或 `any`（要求同时提供 `text` 与 `ocrText`，返回任一条件命中的并集；重复资源只返回一次）。只做 OCR 或结构化筛选时不需要 `text`、图片或 Chinese-CLIP；至少要提供一个查询条件。`personId` 仅用于照片工作区；`favoriteOnly` 匹配被收藏相册、集合或标签中的照片，`pickedOnly` 匹配用户精选的单张照片。`kind` 为必填的 `photo` 或 `comic`，年份为四位数，分页上限 200。例如：`{ "text": "海边散步", "ocrText": "海边散步", "matchMode": "any", "kind": "photo" }`。

带语义查询的结果按精确余弦相似度降序，并返回 `similarity`；与 OCR 组合时，OCR 精确匹配优先于近似匹配，再按余弦排序。`matchMode: "any"` 的 OCR 命中优先于纯语义命中，重复资源去重后统一分页；同级中有语义分数的结果按余弦排序，无语义分数的 OCR 结果按资源 ID 稳定排序。仅 OCR 查询先按精确/近似匹配排序，再按资源 ID 稳定排序；只有结构化筛选时按资源 ID 稳定排序。结果项可含 `matchReasons`：`semantic`、`similar_image`、`ocr_exact`、`ocr_approximate`，用于解释该照片为何入选。每项保留当前媒体 DTO 与所属相册 ID/名称；响应还包含 `total`、`offset`、`nextOffset` 与当前媒体库 `revision`。OCR 只匹配当前 OCR 版本、文件指纹有效的识别文本；匹配时会归一化全半角、中文空格/断行与标点，长中文短语允许一次受限的常见混淆字或插入/遗漏。年份筛选依赖当前版本的 EXIF 拍摄年份，地点筛选按行政区划码匹配（筛一个省包含它下面的市与区县；坐标按记录里的 datum 转到边界使用的 GCJ-02 再判定）。每个候选和最终结果都会按当前媒体根重新验证路径、文件类型及大小/修改时间；响应不包含绝对路径。无效请求返回 `400 invalid_semantic_search`；语义检索缺少模型/运行环境分别返回 `503 ai_model_missing` / `503 ai_runtime_unavailable`。

### `GET /api/images/:fileId/metadata`

在现有图片资源路径重新校验后，读取匹配当前文件大小、修改时间与解析器版本的元数据；尚未分析或结果已过期时返回 `status: "pending"`。结果包含 EXIF 拍摄墙上时间、方向、相机信息及可用时的 GPS 坐标、海拔、时间、方向和精度字段。无 EXIF、格式不支持是正常状态。EXIF 日期不会覆盖相册现有的业务日期。文件 ID 无效返回 `404 resource_not_found`，非图片返回 `415 invalid_metadata_resource`。

### `GET /api/images/:fileId/analysis`

读取与当前文件大小、修改时间及模块版本匹配的 OCR 与人脸结果。`ocr` 包含 `status`、识别文本和文字框；`face` 包含 `status`、人脸框与检测置信度。尚未分析或文件已变化时状态为 `pending`。SFace 特征向量只保存在本机派生记录中，不通过此接口返回。文件 ID 无效返回 `404 resource_not_found`，非图片返回 `415 invalid_analysis_resource`。

### `POST /api/ai/faces/search`

请求为 `{ "resourceId": "…", "faceIndex": 0 }`，用当前图片中指定的人脸查找媒体库相似照片。响应按 SFace 余弦相似度降序，最多返回 40 个结果；低于 `0.363` 的匹配会过滤。候选仅包含当前快照内记录版本和文件指纹匹配、路径通过当前媒体根重新验证的照片。每项返回当前照片 DTO、匹配的人脸序号与相似度，不包含特征向量或绝对路径。结果是相似度线索，不代表已确认人物身份。无效请求返回 `400 invalid_face_search`，没有可用的人脸源记录返回 `404 face_search_source_unavailable`。

### 人物相册 API

- `GET /api/people?sort=photos|review` 在无 `q` 时只返回常见人物：已命名、已分配或明确保留的组，以及至少出现在 3 张照片且包含普通照片的组。只出现在合照中的未确认组和较稀疏的普通组分别通过后两个端点检查。`totalGroups` 是常见人物总数，`filteredGroups` 是仅出现在合照中的未确认组数。按照片数降序返回前 50 组，照片数相同时按封面资源 ID 与人物 ID 稳定排序；`sort=review` 对常见人物按组内锚点相似度 P10、中心相似度 P10、检测分数 P10 从低到高排列，并在每组返回对应 `quality` 指标；这些只是人工复核线索，不代表身份概率。未指定 `sort` 时按 `photos` 处理，其他值返回 `400 invalid_people_sort`。`includeHidden=true` 将手动隐藏且符合上述分类的组加入结果。设置 `q` 可按人物名称或 ID 搜索全部候选组；默认最多返回 20 项，`limit` 上限为 50。响应中的 `confirmed` 表示用户已命名、分配或保留该组；不返回特征向量或文件系统路径。每组另带 `coverFace`：该组封面照片里的代表脸，含 `resourceId`、`box`（原图像素的 `[x, y, 宽, 高]`）与原图 `width` / `height`；原图尺寸读不出来时尺寸为 0，界面据此退回整张封面。
- `GET /api/people/matches?limit=20&offset=0&includeHidden=true` 分页返回待确认匹配源组及最多 3 个目标建议。源组是未确认、未保留、未人工分配，且出现在 1～9 张照片中的组；只出现在合照中的组由合照候选端点承接。出现在 3 张及以上照片的源组只有在索引里存在「可能重复」的近邻关系时才进入列表，避免整页都是没有候选的噪声。建议目标是已确认组、已保留组，或至少有 3 张脸且出现在至少 3 张照片的组；两侧都在待确认范围内时只提示一次方向，由照片更少的一侧发起。不同组须没有同照冲突。返回 `totalSources`、`checkedSources`、`nextOffset` 与 `hasMore`。建议项包含 `similarity`、`bestFaceSimilarity`、`margin` 和跨照片证据计数，`humanConfirmationRequired` 恒为 `true`；这些相似度不是身份概率，也不会触发自动合并。`risk`（`low` / `medium` / `high`）与 `riskReasons` 说明这条建议的可靠程度与风险来源，`evidenceFaces` 与 `targetEvidenceFaces` 给出提供互证的真实照片与人脸框（`box` 为原图像素，另有 `width`、`height` 与 `year`），便于直接核对而不必进出人物详情。无效 `limit` 返回 `400 invalid_people_limit`，无效 `offset` 返回 `400 invalid_people_offset`。
- `POST /api/people/matches/exclude` 接受 `{ "sourceId": "…", "targetId": "…" }`，持久化该组对保持分离的决定，并固定来源组人脸；重建或切换模型后仍遵守当前模型的排除关系。
- `POST /api/people/matches/retain` 接受 `{ "personId": "…" }`，明确保留该组为独立人物，并固定该组人脸；它随后显示在常见人物中。两个写接口的无效组 ID 返回 `400 invalid_person_change`，不存在的组返回 `404 person_not_found`。
- `GET /api/people/group-photo-candidates?limit=20&offset=0&includeHidden=true` 分页返回所有只在合照中出现的未确认组，按独立照片数、脸数、相对脸部尺寸 P10 和检测分数 P10 排序。响应 `items[]` 含 `person` 和 `stats`（`photoCount`、`groupPhotoCount`、`ordinaryPhotoCount`、`relativeFaceSizeP10`、`detectionP10`），并返回 `total`、`nextOffset`、`hasMore` 及 `faceCountThreshold`、`minimumFaceCount`、`relativeFaceSizeThreshold`。合照判定为检测脸数超过 20，或至少 8 张脸且脸部相对图像长边的中位数不超过 0.04；源图尺寸未知时只按脸数判断。每组必须只在这类照片中出现才列为候选。用户可检查详情或明确保留人物；列表筛选不删除分析数据。分页参数与匹配端点使用相同的校验。
- `GET /api/people/:personId/media?cursor=…&limit=200` 返回人物相册分页、当前照片 DTO 与可供纠错的脸部框/序号；照片 DTO 含原图像素宽高，供照片墙将脸部框准确投影到合照上。每张照片最多存储 256 张脸，`faceIndex` 范围为 0–255。只在本页校验源文件路径与指纹，并批量补齐媒体尺寸。
- `PUT /api/people/:personId` 接受 `name` 和/或 `hidden`；空名称恢复默认名称。
- `POST /api/people/merge` 接受 `{ "sourceId": "…", "targetId": "…" }`，将来源组的脸分配给目标组。
- `POST /api/people/split` 接受 `{ "personId": "…", "faceKeys": ["f_…#0"] }`，将选中脸拆到新组；每次最多 200 张，必须给原组留至少一张脸。
- `DELETE /api/people` 在没有活动人脸任务时关闭人物分析，并清除人脸任务结果、分组索引与手动修正。存在活动或排队任务时返回 `409 analysis_job_active`。

人物分组列表同时返回 `centroidThreshold` 与 `anchorThreshold`。候选脸须与当前组中心的余弦高于 `0.520`，并与创建该组的固定锚脸高于 `0.720`；锚脸在组生命周期内不随高分新脸替换。初步分组后会复核可能重复的组：只检查组中心 HNSW 的前 64 个候选，每个来源组按资源 ID 均匀抽样最多 256 张脸；组中心相似度至少 `0.820`，两组各有至少 10 张脸且没有共同来源照片；跨组需要至少 `max(2, 较小组脸数的 5%)` 组互为最近邻的人脸对，每对相似度至少 `0.720`、平均相似度至少 `0.750`。多组归并采用完全链接，组件内任意两组都必须有直接匹配证据；可重建索引保存自动合并前的来源组 ID，增量更新时逐一检查每对来源组，防止后续批次借聚合中心链式扩张；有改名、隐藏或人工分配的人物组不会自动归并。该步骤可找回跨年龄、姿态或画质变化后分裂的同一人，同时限制相似脸链式扩张。之前的“移动中心 + 可替换代表脸”会让连续的中等相似脸逐步拖动组中心，把相距很远的人脸链式并入同组；分组算法版本升级会全量重建派生索引。分组不把 CLIP 整图相似度当作身份辅助证据。一个组不会包含同一张照片里的两张脸。阈值仍是启发值，没有本机标注集校准，不能确认身份。OpenCV 的 SFace `0.363` 是两张脸验证的参考值，不代表全库聚类阈值或身份确认。每张脸先用 HNSW 找最多 128 个近邻组，再按当前中心精确重算余弦相似度；近邻搜索是近似索引，仍可能漏掉匹配组，因此结果保持可编辑。待确认匹配另有独立的召回链路：索引里为每个分组记录中心向量与锚脸各自的近邻关系，复核时再用两侧代表脸互相精确复核；代表脸按照片取，因此每一对互证天然来自两张不同照片。相同分数按人物 ID 稳定决胜，不设比较次数或人脸总数上限。输入按资源 ID 与脸序号排序，旧组的命名、隐藏与分配在重建时按人脸重叠迁移；自动重建若会合并多个已有人工修正的组或拆分一个已有人工修正的组，旧分组保持独立，直到用户显式合并或拆分。人物媒体分页继续以照片为单位，拆分选择器每次显示 200 张已加载人脸，可逐段展开。用户修正保存在 `state/people-<model>.json`；可重建索引位于 `derived/ai/people-index-<model>.json`，只存资源 ID、文件指纹、脸部框、记录哈希、当前组 ID 与自动合并来源组 ID，不保存特征向量。SFace 特征只保存在现有 `derived/metadata/face/` 结果中。

### 人物标注 API

人物标注是给人脸识别质量评估用的本机工作台。它与人物修正完全分开：标注只描述「这张照片里有哪些人脸、属于哪个匿名身份」，既不改写人物分组，也不改写命名、合并、排除与保留的决定，更不会修改原始照片。

这组接口只允许回环访问：导出评测集会带上本地文件的绝对路径，与目录管理、状态导出这些本机管理接口同级。

- `GET /api/admin/people/annotations/samples?limit=60&refresh=true` 返回待标注的样本清单。样本来自三处：待确认匹配的来源组与目标组、只在合照中出现的组、以及锚点与中心相似度最低的低质量分组。抽样结果按顺序保存在本机，`refresh=true` 才重新抽取。响应含 `items[]`（`resourceId`、`reason`、`faceCount`、`reviewed`、`identities`）、`progress` 与 `scenarioTags`。
- `GET /api/admin/people/annotations/photo/:resourceId` 返回这张照片的检出人脸与已有标注。`detected[]` 含 `key`、`faceIndex`、`box`（原图像素）与 `score`；`annotation` 为已保存的标注，没有时为 `null`。
- `POST /api/admin/people/annotations/photo` 保存一张照片的标注，body 为 `{ "resourceId": "…", "tags": ["groupPhoto"], "faces": [{ "identity": "id-001", "box": [x, y, w, h], "smallFace": false, "source": "manual" }], "reviewed": true }`。身份必须是已存在的匿名身份，框宽高必须为正；不合法返回 `400 invalid_people_annotation`。
- `GET /api/admin/people/annotations/identities` 列出匿名身份；`POST` 同路径用 `{ "label": "妈妈" }` 新建一个，身份 ID 由本机生成，用户不需要写真实姓名。
- `GET /api/admin/people/annotations/progress` 返回标注进度。
- `GET /api/admin/people/annotations/dataset` 下载评测集，格式为 `schemaVersion=1`：`photos[]` 含 `resourceId`、`path`（本地绝对路径）、`tags` 与 `faces[]`（`box`、`identity`、可选 `smallFace`）。这与 `backend/aiworker/evaluate_people.py` 读取的格式一致，可以直接交给它比较不同模型与检测方式。

标注进度保存在 `state/people-annotations.json`，与 `state/people-<model>.json` 分开；两者互不影响，重启或重建索引后都保留。标注数据只在本机保存，默认不上传，也不进版本库。

### 相似照片整理 API

相似照片整理把「同一张照片的多个副本」「裁剪压缩过的近似照片」「短时间连拍的同一场景」分成三类独立结果。三类不混：连拍组里的每一张都是不同的画面，只是拍的是同一个瞬间，因此绝不按重复处理。整理结果只用于发现与挑选，不删除、不移动、不覆盖任何原始媒体。

特征提取是新增的分析模块 `similarity`，在本机用标准库完成，不依赖本机 AI Worker：

- `GET /api/similarity/status` 返回整理模块的整体状态：`analyzed` 是已算出特征的照片张数，`total` 是媒体库照片总数，`hasVectors` 说明语义向量索引是否可用（可用时近似重复的复核更准），`builtAt` 是分组结果的生成时间，`stale` 说明特征已变、分组需要重建，`rebuilding` 说明正在重建，`limited` 说明候选召回触到了上限（此时结果可能不完整），`summary` 是分组总量。
- `GET /api/similarity/groups?kind=&folder=&status=&limit=&offset=` 返回分组。`kind` 取 `exact`（完全重复）、`near`（近似重复）、`burst`（连拍同场景）或空串表示全部；`status` 取 `pending`、`reviewed`、`ignored` 或空串；`folder` 按文件夹别名筛选；`resourceId` 只返回含有这张照片的分组（照片墙上展开一组时用它读回成员名单）。`limit` 上限 200，`offset` 分页。响应 `page` 含 `groups[]`、`folders[]`（有结果的文件夹与各自组数）、`summary`（`exact`/`near`/`burst` 三类组数、`pending`/`reviewed`/`ignored` 状态数、`photos` 参与整理的张数、`redundant` 每组保留一张之外的多余张数）、`stale` 与 `limited`。无效 `limit` 或 `offset` 返回 `400 invalid_similarity_query`。
- 每个分组含 `id`、`kind`、`folder`、`resourceIds[]`、`members[]`、`recommended`（算法建议的代表照片）、`representative`（当前生效的代表照片）、`representativeIsManual`（代表照片是否由用户指定）、`distance`（组内成员与代表照片的最大感知哈希距离）、`similarity`、`timeSpanMs`、`timeSource`（`capture` 为 EXIF 拍摄时间，`file` 为文件修改时间的退路）、`crossFolder`、`status` 与 `redundant`。每个成员含 `resourceId`、`folder`、`albumId`、`albumName`、原图像素 `width`/`height`、`capturedAt`、`distance`、`similarity` 与 `quality`。`quality` 是可解释的质量分项：`sharpness`（拉普拉斯响应的方差）、`sharpnessScore`、`megapixels`、`resolutionScore`、`exposure`（灰度均值）、`clippedHigh`、`clippedLow`、`exposureScore` 与 `score`。代表评分按清晰度 0.45、分辨率 0.25、曝光 0.30 加权，与文件大小无关。
- `PUT /api/similarity/groups/:id` 写人工决定，body 为 `{ "representative"?: "f_…" }`、`{ "reviewed"?: true }` 或 `{ "ignored"?: true }`，一次可给一种。`representative` 必须指向组内成员，否则返回 `400 invalid_similarity_request`；分组不存在时返回 `404 similarity_group_not_found`。标记处理与忽略互斥，后写的一个生效。字段名沿用 `reviewed` / `ignored`，界面上的说法是「已处理」与「已忽略」。
- `POST /api/similarity/batch` 对一组分组执行同一个动作，body 为 `{ "action": "review"|"unreview"|"ignore"|"unignore"|"pick", "groupIds": ["…"] }`。`pick` 把每组当前生效的代表照片加入现有的照片级精选（`state/picks.json`），返回的 `changed` 是实际加入精选的张数。分组 ID 不存在时按未命中处理；未知动作返回 `400 invalid_similarity_batch`。
- `POST /api/similarity/rebuild` 按当前特征重算分组，响应含重算后的 `summary`。特征已经变了但还没重建时用它，不必再跑一遍分析任务；服务启动时若分组比分析结果旧，也会在后台自动重算一次。媒体库尚未就绪返回 `400 library_not_ready`。

分组结果是可重建的派生数据，写在 `derived/ai/similarity/groups.json`；人工决定（处理状态、忽略、指定代表）写在 `state/similarity.json`，重建之后仍然生效，并随状态备份的 `similarity` 类别一起导出与恢复。组的标识取组内最小的资源标识，因此组变大变小都不会换号。

### 足迹页 API

三个地图端点与一个媒体页端点共享一组可选的查询参数：

| 参数     | 含义                                                          |
| -------- | ------------------------------------------------------------- |
| `from`   | 时间区间起点，`YYYY-MM`，左闭                                |
| `to`     | 时间区间终点，`YYYY-MM`，右闭                                |
| `visit`  | 只在媒体页上有效：到访序号（从 0 开始），缺省表示不按到访筛 |

时间区间按 EXIF 拍摄时间的日历月比较，缺省表示不限。格式非法或 `from` 晚于 `to` 返回 `400 invalid_time_range`；`visit` 不是非负整数返回 `400 invalid_region_visit`。区间与到访序号都参与 `ETag`，换区间后旧响应不会命中 `304`。

### `GET /api/locations/china`

返回全国省级照片统计：`locations` 含 `revision`、离线边界 `boundaryVersion`、GPS/境内/未归属照片数、全库图片总数 `totalPhotoCount`（不含视频，不随时间区间变化）、有照片的行政区数量（`provinceCount` / `cityCount` / `districtCount`），以及 34 个省级 `provinces`（含 `photoCount` 与 `unmatchedAreaPhotoCount`）。`totalPhotoCount` 给「有多少张照片」一个分母：`gpsPhotoCount` 说清了有多少张带位置，但没有分母就看不出覆盖率。该未细分数表示照片已匹配到省，但没有命中该省的直接下级边界。**响应不含绘图几何**：统计与几何是两份数据，几何由 `GET /api/locations/china/geometry/:level` 单独下发（见下）。响应带 `ETag`，可用 `If-None-Match` 获取 `304`。只统计当前快照中仍存在、版本指纹匹配且路径通过当前媒体根校验的照片。WGS84 GPS 会在本机转换到边界使用的 GCJ-02 后做点位匹配；响应不包含照片原始坐标与文件路径。边界数据来源、版本和限制见 [架构文档](./ARCHITECTURE.md#exifgps-与离线地点地图)。

除上述字段外还包含三个时间字段：

- `months`：当前区间内的逐月分布，每项为 `{ "month": "2024-06", "count": 123 }`，按月份升序；
- `trajectory`：当前区间内的停靠序列，每项为 `{ "at", "until", "adcode", "name", "photoCount" }`（`at`/`until` 是该段首尾照片的拍摄日期）。停靠点只给区划码与名称，不含照片坐标；
- `untimedPhotoCount`：有位置但拍摄时间不可信（解析不出、年份早于 1990 或晚于当下）的照片数。这些照片照常计入空间统计，但不进逐月分布、轨迹与到访。

### `GET /api/locations/china/regions/:adcode`

返回指定行政区及其**直接下级**区域的地图。省级区划返回城市与省直辖区县；城市返回区县；末级区域的 `regions` 为空。`region` 包含当前区域的 `adcode`、`name`、`level`、照片数、到访次数（`visitCount`）、有可信拍摄时间的首末日期（`firstAt` / `lastAt`，没有可信时间时是空串）、代表照（`coverResourceIds`，最多 4 个）、`parentAdcode` 和 `ancestors`；`ancestors` 按全国到直接上级排列，供完整面包屑导航。当前区域有照片但未命中任何直接下级边界的数量由 `unmatchedAreaPhotoCount` 给出。城市照片数包含其下辖区县的照片；每项 `regions` 仅统计落在该直接下级中的照片，并包含区划码、名称、级别与照片数。绘图几何同样由 `GET /api/locations/china/geometry/:level` 单独下发。响应也支持 `ETag` / `If-None-Match`。区划码格式错误返回 `400 invalid_region_adcode`，边界中不存在返回 `404 region_not_found`。

响应同样包含 `months`、`trajectory` 与 `untimedPhotoCount`，口径跟随当前区间与当前区域：`months` 是该区域自己的逐月分布，`trajectory` 是该区域直接下级之间的停靠序列。省级轨迹落到城市或省直辖区县，城市轨迹落到区县。

### `GET /api/locations/china/regions/:adcode/visits`

返回指定区域的到访记录。`visits` 按开始时间升序，每项为：

| 字段        | 含义                                             |
| ----------- | ------------------------------------------------ |
| `startedAt` | 第一次到访的拍摄日期（`YYYY-MM-DD`）             |
| `endedAt`   | 最后一次到访的拍摄日期                           |
| `dayCount`  | 这段到访跨的自然日天数                           |
| `photoCount`| 这段到访里的照片数                               |
| `regions`   | 同期出现过的其它区域，每项 `{ "adcode", "name", "count" }` |

`regions` 始终是数组（没有则为 `[]`）。同一区域的照片按拍摄时间排序后，相邻两张的日历日间隔不超过 2 天算作同一次到访，超过则另算一次；`visit` 序号与本列表的下标一一对应。响应同样包含 `region` 与 `untimedPhotoCount`，其中 `region.visitCount` 是这次到访的切分次数。区划码格式错误返回 `400 invalid_region_adcode`，边界中不存在返回 `404 region_not_found`。

### `GET /api/locations/china/regions/:adcode/media?cursor=…&limit=200`

返回指定区域的照片墙分页和区域摘要。`cursor` 是绑定当前媒体库 revision、区间与到访序号的不透明游标；路径会按当前媒体根重新校验。给了 `from`/`to` 或 `visit` 时照片按拍摄时间排序，否则维持相册顺序。不存在的区划返回 `404 region_not_found`。

### `GET /api/locations/china/geometry/:level`

返回绘图用的行政区轮廓。`level` 取 `province`、`city`、`district` 或 `children`：

- `province` 且不给 `parent`：全部 34 个省；
- `children` 且给 `parent`：该上级的**全部直接下级**，不拘层级 —— 河南、湖北、海南、新疆的省下面同时挂着地级市与省直辖县级区域，按单一层级取会漏掉一半；
- `city` / `district` 且给 `parent`：该上级之下这一层级的要素。

响应含 `boundaryVersion`（绘图轮廓的版本，与匹配数据的版本分开）、`hash`（内容指纹）、`level`、`parentAdcode` 与 `features`；每项 `features` 是 `{ "adcode", "name", "level", "geometry" }`，`geometry` 是 `Polygon` 或 `MultiPolygon`。

这个端点与媒体库无关：轮廓是静态数据，只随边界数据变化。因此它的 `ETag` 只依赖轮廓文件的内容指纹（`W/"china-outline-<level>-<parent>-<hash>"`），并带 `Cache-Control: private, max-age=86400`，媒体库变化时不必重下几何。轮廓按层级分档简化（省 0.01°、市 0.004°、区县 0.002°），全国省图约 266 KB（gzip），整份轮廓不下发。

`level` 非法返回 `400 invalid_region_level`；`parent` 不是正整数返回 `400 invalid_region_adcode`；`parent` 对应的区划不存在返回 `404 region_not_found`。

### `GET /api/locations/china/geometry/features?adcodes=…`

按区划码取绘图轮廓。`adcodes` 是逗号分隔的十进制区划码，重复的会去重。

这个端点解决的是「前端推不出父级」：直辖市的区县没有市一级（`310104` 直接挂在 `310000` 下），省直辖县级市在市级粒度里会卷到省，而同一个粒度的地方列表里可能同时混着 `level: "province"` 与 `level: "city"` 的条目。按父级取轮廓要走这些推导，按区划码取就没有这层麻烦。

响应含 `boundaryVersion`、`hash` 与 `features`（每项是 `{ "adcode", "name", "level", "geometry" }`）。查不到的区划码被跳过而不是报错 —— 台湾的区县本来就没有可用边界。

与其它轮廓端点一样，它与媒体库无关：`ETag` 只依赖轮廓文件的内容指纹与请求的区划码集合（`W/"china-outline-features-<hash>-<摘要>"`），并带 `Cache-Control: private, max-age=86400`。`adcodes` 不是逗号分隔的正整数时返回 `400 invalid_region_adcode`。

### `GET /api/locations/china/points`

返回照片位置的**网格聚合**。行政区匹配只答得出「落在哪个市、区县」，点位才画得出城市的样子 —— 地图上那层点就是它。

| 参数  | 含义                                                          |
| ----- | ------------------------------------------------------------- |
| `cell`| 格边长（度），只认 `0.01` / `0.02` / `0.05` / `0.1` / `0.2` / `0.5` 六档，缺省 `0.02` |

`points` 含：

| 字段    | 含义                                                         |
| ------- | ------------------------------------------------------------ |
| `revision` | 媒体库版本                                                 |
| `cell`  | 实际生效的格边长（度）                                        |
| `total` | 落进这些格子的照片总数                                        |
| `cells` | 网格数                                                       |
| `items` | 网格列表                                                     |

每项 `items` 是 `{ "lon", "lat", "count", "untimed", "firstAt", "lastAt" }`：`lon`/`lat` 是**格心**（不是照片坐标的平均值），`count` 是这一格里的照片数，`untimed` 是其中没有可信拍摄时间的张数，`firstAt`/`lastAt` 是有可信拍摄时间的那部分的首末日期（这一格全是没时间的照片时是空串）。

**时间区间的口径与其它端点不同**：`from`/`to` 照常按拍摄时间的日历月过滤，但**没有可信拍摄时间的照片一律保留**。它们有真实位置，只是没法判断在不在区间里；一并丢掉的话，一张没设时钟的照片就会让整张地图空掉。它们在 `untimed` 里单独计数。

**格边长是档位，不是连续参数**：请求给的是最小值，格数超过 4000 时服务端会自动调粗，`cell` 里回报实际生效的那一档。格心取 `floor(lon/cell) * cell + cell/2`。足迹页的地图只有几百像素宽，用的是 `0.2` 这一档 —— 几公里的一格在那个尺寸里不到一个像素。

响应里没有资源 ID、没有文件路径，也没有单张照片的经纬度 —— 只有一格在哪儿、那儿有多少张。坐标与边界都在本机处理，不调用在线地图或地理编码服务。

`cell` 不在六档之内返回 `400 invalid_point_cell`；`from`/`to` 非法返回 `400 invalid_time_range`。`ETag` 里带着格边长与区间（`W/"china-points-<...>"`），换格边长不会命中上一粒度的 `304`。

### `GET /api/locations/china/places`

返回地点索引：去过哪些地方。

| 参数    | 含义                                                       |
| ------- | ---------------------------------------------------------- |
| `level` | 归并粒度：`province`、`city` 或 `district`，缺省 `province` |
| `parent`| 限定在某个上级之下（十进制区划码）                          |

`places` 含 `revision`、`boundaryVersion`、`level`、`total`、GPS/境内/未归属照片数与 `items` 列表。每项 `items` 是：

| 字段               | 含义                                                     |
| ------------------ | -------------------------------------------------------- |
| `adcode`           | 区划码                                                   |
| `name`             | 名称                                                     |
| `level`            | 这个地方本身的层级（`province` / `city` / `district`）   |
| `photoCount`       | 归并到这一层的照片数（含下级）                           |
| `unmatchedCount`   | 没有落到任何直接下级的照片数                             |
| `visitCount`       | 按到访口径切出的次数                                     |
| `firstAt`/`lastAt` | 有可信拍摄时间的第一天与最后一天；没有可信时间时是空串  |
| `coverResourceIds` | 代表照的资源 ID，最多 4 张                               |

**归并粒度的含义**：「市」粒度下，区县的照片归到它所属的市；直辖市的区县没有市一级，往上退到直辖市本身 —— 这正是用户心里的说法。每一行带自己的 `level`，因此列表里可能出现不同层级的行。

**只列有照片的地方**：没有照片的省不在索引里（地图上仍然完整可见）。`photoCount` 是子树合计，父子之间会重复计数；`visitCount` 按每个地方各自切分，因此省级的到访次数不等于其下级城市之和。

时间区间 `from`/`to` 与其它地点端点一致，参与 `ETag`。

### `GET /api/locations/china/trips`

返回行程与停留：什么时候去了哪些地方。

| 参数          | 含义                                                    |
| ------------- | ------------------------------------------------------- |
| `granularity` | 粒度：`province`、`city` 或 `district`，缺省 `city`    |
| `gapDays`     | 切分两段行程的最大间隔（天），1–365，缺省 14       |

`trips` 含 `revision`、`boundaryVersion`、`granularity`、`gapDays`、`total` 与 `items` 列表。每项 `items` 是：

| 字段              | 含义                                                   |
| ----------------- | ------------------------------------------------------ |
| `id`              | 稳定标识（起始日 + 第一个停留点的区划码）               |
| `kind`            | `trip`（走过多个地方）或 `stay`（只在一个地方）        |
| `startedAt`/`endedAt` | 这一段的开始与结束日期                            |
| `dayCount`        | 这一段跨的自然日天数                                   |
| `photoCount`      | 这一段落在粒度上的照片数                               |
| `stops`           | 停留点序列，每项 `{ "adcode", "name", "level", "parentAdcode", "at", "until", "dayCount", "photoCount" }` |
| `coverResourceIds`| 代表照的资源 ID，最多 4 张                             |
| `index`           | 这段在 `items` 里的序号（从 0 起），照片端点按它寻址   |
| `bandResourceIds` | 照片带用的资源 ID，最多 12 张                          |

**切分口径比到访宽**：相邻照片的日历日间隔超过 `gapDays` 天就断开，缺省 14 天。两天的口径是「回来算又一次到访」，拿来做行程会把出门一趟切成好几段。区别还在粒度：到访比的是同一个地方，行程比的是「去了哪些地方」；一段里只出现一个地方时它是 `stay」。市级粒度下「西湖区 → 余杭区」是同一次停留，符合人的说法。

`parentAdcode` 是停留点的直接上级（省级停留点为 `null`）：界面按它去取「停留点所在的那一层轮廓」—— 停留点是市，它的直接上级就是省，轮廓取该省的城市；停留点是省，上级为空，轮廓取全国各省。

`bandResourceIds` 按时间**均匀采样**，不是只取开头几张：一段行程是一个跨度，只给开头几张会把这段讲成「刚到那儿」。采样点含首尾，因此带子既看得到开头，也看得到收尾。

`from`/`to` 会改变切分结果，因此**行程列表与行程照片端点必须带同一组区间参数**（或都不带）。界面上的做法是：行程永远按全量切分，时间带上的刷选只决定哪些段被点亮 —— 段若随区间重切，段的下标就再也指不到同一段照片了。

### `GET /api/locations/china/trips/:index/media`

返回某一段行程的照片分页。

| 参数          | 含义                                                    |
| ------------- | ------------------------------------------------------- |
| `granularity` | 粒度：`province`、`city` 或 `district`，缺省 `city`    |
| `gapDays`     | 切分两段行程的最大间隔（天），1–365，缺省 14            |
| `from`/`to`   | 时间区间，`YYYY-MM`，左闭右闭                         |
| `cursor`/`limit` | 分页游标与页大小，页大小缺省 60、上限 200         |

`page` 的结构与区域照片墙一致（`items` / `total` / `nextCursor` / `albums`），另带 `trip`：这一段的行程信息。

**段与照片必须用同一套切分口径**：行程是按「粒度 + 间隔 + 时间区间」切出来的，因此取照片时必须带上同样的 `granularity`、`gapDays` 与 `from`/`to`，否则按下标取到的不是同一段。序号越界返回 `404 trip_not_found`，序号不是非负整数返回 `400 invalid_trip_index`。

## 相册与搜索

### `GET /api/search?q=<keyword>&limit=50&kind=photo|comic`

搜索按名称和标签匹配相册、集合和标签，结果中的 `path` 是相册/集合 ID；相册与标签结果可带 `tags: string[]`。标签结果使用 `smart:<tag>` 作为内部标签标识，前端统一转换到 `/tags/<tag>`。搜索条目在每次媒体库 revision 发布时预计算，查询不会递归读取完整目录树。

`kind` 与其它列表接口同义（必填），过滤全部命中：相册与集合按目录属性归属，标签按该属性下是否还有相册判断。

结果按匹配质量排序后再按 `limit` 截断：完全等于查询 > 名字以查询开头 > 名字包含查询 > 标签命中；同等质量下名字更短的排在前面。散图（"本目录媒体"）的 `name` 是归属目录路径，只有命中它自己那一段目录名才算名字命中，只命中上级目录名（路径里的同名目录）排在最后 —— 用户找的是"哪一本"，不是"哪一棵树"。

每条命中另带 `match`，说明它为什么算命中：`exact`（名字完全等于查询）、`prefix`（名字以查询开头）、`contains`（名字包含查询）、`tag`（标签命中）、`path`（只在散图的归属路径里命中）。它与排序档位一一对应，界面据此写出一句「相关性」——用户看到的是理由，不是一个分数。

散图（"本目录媒体"）的搜索条目 `name` 是归属目录路径，并带 `virtual: true`：它的展示名与同名集合完全一致，前端据此把类型标签显示成"散图"而不是"文件夹"。

`limit` 默认 50、上限 500；`cursor` 用于读取后续页。`results` 只含当前页，`count` 是全部命中总数，非空 `nextCursor` 表示还有下一页。游标绑定搜索词、`kind` 与媒体库 revision；媒体库更新后继续读取会返回 `409 stale_cursor`。

### `PUT /api/albums/:albumId/cover?file=<fileId>`

设置自定义封面。文件必须属于相册、已被本次扫描收录，且为受支持图片或视频。覆盖在每次新扫描发布前重新验证和应用，不会因重扫丢失；已移动/删除的封面记录会被忽略。

### `DELETE /api/albums/:albumId/cover`

清除自定义封面并恢复扫描器默认封面。

### 智能相册分组

- `GET /api/smart-albums?dimension=recommended|time|place|people|scene|all|featured&cursor=…&limit=60&sort=time|photos|quality` 跨照片文件夹汇总已生成的智能分组（默认 `recommended`，单页默认 60、最多 200），返回 `page.items`、`total` 与 `nextCursor`。`recommended` 返回精选主题；`all` 汇总四类详细分类（不含精选主题）；`featured` 按推荐质量并按来源文件夹轮流取样，供首页预览。每项含来源相册 ID/名称、所属集合名与分组摘要；推荐组摘要含 `qualityScore`、`evidenceDimensions` 与 `recommendationReasons`；`overrideConflict` 表示多个旧修改合并后等待用户复核。`coverResourceId` / `coverVersion` 指向封面图（服务端只等比缩放、不裁剪；客户端按原比例把照片摆进方形槽位，因此不再需要原始像素尺寸）。只读取已有分组缓存，不为尚未生成推荐的相册启动计算，媒体有变化也照旧列出已生成的结果（更新由全库刷新任务负责）。隐藏分组不进入目录；游标绑定库版本、维度、排序方式与汇总目录版本。`sort` 只对 `recommended` 生效：默认 `time`（组内最新一张照片的拍摄时间倒序，读不出时间的主题排最后），另有 `photos`（照片张数倒序）与 `quality`（推荐分倒序）；认不出来的取值按 `time` 处理，不报错。空汇总的 `items` 是空数组，不是 `null`。
- `dimension=all` 的 `page.analysis` 报告 `totalAlbums`、`analyzedAlbums` 与 `complete`：只有五个维度的缓存都已生成才算完整，空分组也是已完成结果；此字段用于区分尚未生成与分析后无分组。其他维度不返回该字段。
- **汇总的排序**：同一本相册的分组挨在一起（相册内按该维度自己的次序：时间维度从新到旧，其余维度按张数从多到少）；相册之间按「这本相册最新的一组」排 —— 时间维度看那一组封面照片的 EXIF 拍摄时间（从新到旧），其余维度看该相册张数最多的那一组，读不到时间信息的相册排在有时间的之后。同分按相册名兜底。
- `GET /api/albums/:albumId/smart-groups?dimension=recommended|time|place|people|scene` 返回该照片相册的分组摘要、分析覆盖率与未分组照片数。相册内直接图片是唯一分析范围，分组不会跨相册。摘要只返回分组 ID、名称、照片数和封面，不返回成员清单、路径或 GPS 坐标。`dimension=recommended` 返回精选主题，其分组摘要另带 `qualityScore`、`evidenceDimensions`（时间、地点、人物、场景的子集，顺序固定）与 `recommendationReasons`；该维度的 `coverage.module` 固定为 `combined`：`analyzed` 是相册内可读文件数，`missing` 是文件不可用数（不是未分析数），`failed` 恒为 0，`withEvidence` 是进入至少一个推荐组的去重照片数，`available` 表示相册内还有可读文件。推荐维度不提供分模块覆盖明细，模块安装状态与人物分析开关见 `GET /api/ai/jobs`。
- `POST /api/albums/:albumId/smart-groups/rebuild?dimension=…` 按当前分析记录重建选定维度并刷新派生缓存。
- `PUT /api/albums/:albumId/smart-groups/:groupId?dimension=…` 接受 `{ "name"?: "…", "hidden"?: boolean }`，用于自定义名称或隐藏分组；名称最多 60 个字符，空名称恢复建议名。
- `GET /api/albums/:albumId/smart-groups/:groupId/media?dimension=…&snapshot=…&cursor=…&limit=200` 只分页返回该相册该分组的图片 DTO。每页重新验证当前相册成员、文件路径边界、普通文件类型与生成分组时的文件指纹；库变化或快照过期后应重新读取分组摘要。

时间只使用可信 EXIF 拍摄时间，按日期与自适应拍摄间隔形成分组；地点按文件夹内位置数量选择行政区域粒度或 geohash，接口不返回原始坐标；人物复用当前人物候选组在本相册内的成员；场景复用现有 Chinese-CLIP 向量，并给出可编辑的建议标签。详细分组至少 3 张；精选推荐至少 12 张且质量分不低于 0.82，并结合证据覆盖、场景凝聚度、与来源文件夹的重叠及名称新信息评分。仅有相似场景证据不会直接升级为推荐；每个来源文件夹最多保留一个由人物分组起始的推荐，且需有场景支撑；近似覆盖整本文件夹的推荐只有具备新增组织价值时才保留；成员包含率达到 0.60 或 Jaccard 重叠达到 0.40 的候选只保留质量更高的一条。推荐 ID 由来源相册和种子分组稳定派生；重算会按成员重叠迁移名称与隐藏状态，冲突时保留旧修改并标记待复核。派生成员清单写入 `derived/ai/smart-albums/`，人工名称与隐藏状态写入 `state/smart_album_overrides.json`，状态备份的 `smartAlbums` 类别包含这些修正。

### 全库智能相册刷新

全库刷新是后台任务：手动触发与每日计划共用同一个任务服务，同一时刻只跑一个。

- `POST /api/smart-albums/refresh` 请求 `{ "force": false }`，启动一次全库刷新，返回 `{ ok, jobId, reused, force }`。`force` 为真时无视缓存，把所有照片相册的四类详细分类和精选推荐共五个维度全部重算；缺省只重建媒体或分析结果有变化的组合。已有任务在跑时复用它（`reused=true`），不会并发重建。服务关闭或分组服务不可用时返回 `503 smart_album_refresh_failed`。
- `GET /api/smart-albums/refresh/active` 返回当前任务（最近一次刷新）的进度快照 `{ ok, task }`；本进程还没有跑过刷新时 `task` 为 `null` —— 这是常规状态查询，不是错误。
- `GET /api/smart-albums/refresh/:id` 返回指定任务的进度快照：`{ jobId, status, force, albums, total, done, rebuilt, reused, groups, currentAlbumId, currentAlbumName, currentDimension, elapsedMs, error? }`。`status` 取 `pending|running|complete|cancelled|error`；`total` 是「相册 × 五个维度」的组合总数；`rebuilt` 是重算的组合数，`reused` 是命中缓存直接复用的组合数。任务不存在时返回 `404 smart_album_refresh_not_found`。
- `DELETE /api/smart-albums/refresh/:id` 取消正在进行的刷新；任务已经结束时返回 `{ ok: true, alreadyDone: true }`。
- `GET /api/smart-albums/refresh/:id/events` 以 SSE 推送进度，事件名与任务状态同名，`data` 为同一份进度快照，终态事件后连接关闭。

失败时 `error` 只给机器可读的错误码（`library_not_ready`、`library_changed`、`smart_album_failed`），不回传本机路径。

## 媒体、缩略图与视频

### `GET /api/media/:fileId`

发送图片或视频，支持 ETag 和 Range；视频按需经过转码和 faststart 管线。

前端视频消费使用 `/api/media/:fileId?playback=<不透明播放标识>`。每次播放切换、重试、转码后重新加载和抽帧生成新标识，同次播放的多个 Range 请求沿用同一 URL；标识用于隔离浏览器媒体缓冲。服务端仍只按文件 ID 校验权限并选择当前文件，`playback` 不选择文件版本、不传递路径或凭据，也不替代收藏、历史和活动记录中的资源 ID。直接使用不带标识的资源地址仍须重新验证 HTTP 缓存。

原图与视频的每个响应独立打开最终选择的文件，ETag、Last-Modified、Content-Length 和 Range 总长度来自该次打开的文件信息，不复用旧文件句柄或旧长度。同一路径在响应之间被覆盖、缩小或替换后，无需等待文件服务缓存过期。流在完成或中断后关闭；HEAD、304 和错误响应也释放句柄。

支持单段 `Range: bytes=start-end`、`bytes=start-` 和 `bytes=-count`。未带 `If-Range`，或其值为当前强 ETag、与 Last-Modified 精确到秒相同的 HTTP 日期时，按范围返回 `206`。`If-Range` 过期、为弱 ETag、ETag 列表、无效值或不匹配的日期时，忽略 Range 并返回完整当前文件（`200`，不带 Content-Range），即使该 Range 越界也不会返回 416。常规缓存条件先于 If-Range 判断；匹配的 If-None-Match 仍返回 304。

需要处理范围时，无效范围、空后缀或多段范围返回 `416 invalid_range`，携带 `Content-Range: bytes */<当前大小>` 和 `Cache-Control: no-store`，不带 ETag。HEAD 不传输媒体内容；不带 Range 时返回当前完整长度。

响应前确认源路径仍为普通文件；扫描后被目录或其他非普通文件替换时，图片返回 `404 media_not_found`，视频返回 `404 video_not_found`。此检查先于 ETag、Range、转码缓存选择和文件发送，不返回目录重定向或携带本地路径的 `Location`，也不因条件请求返回 304。源文件恢复后，原 ID 可继续使用。

视频派生缓存仅命中非空普通文件，不跟随缓存条目自身的链接。空文件、目录及链接不会直接发送或用于 304 协商；空缓存按需重新生成，生成失败时沿用后续 faststart 或源文件流程，不返回缓存目录重定向。目录占位及其内容保留。

浏览器原生解不了的图片格式（HEIC/HEIF/TIFF）不按原文件发送：服务端用 ffmpeg 转成 JPEG（最长边 2560）后再返回，`Content-Type` 为 `image/jpeg`，ETag 仍取源文件的 mtime+size，因此条件请求照常协商 304。转换结果按源文件 mtime+size 派生的键缓存在 `derived/converted/`，第二次访问直接命中缓存。ffmpeg 不可用或转换失败时返回 `415 unsupported_image_format`，前端显示"该图片无法显示"，不再把浏览器解不了的原文件当图片发出去。

### `GET /api/previews/:fileId?w=<像素宽度>&v=<内容版本号>`

返回按宽度等比缩放的预览图（JPEG）。`w` 缺省 1600，非数字或非正数返回 `400 invalid_preview_width`；宽度会**向上对齐**到固定档位阶梯 320 / 640 / 1280 / 1920 / 2560 / 4096。

阅读器连续模式按视口宽度展示图片。直接发原图的话，手机照片动辄 12MP / 5MB，一屏就是几 MB，整本翻下来是 GB 级流量，浏览器还要为每张原图解码出几十 MB 位图。预览图按请求宽度缩放后约 200–400KB。

源图比 `w` 还窄时直接返回原图字节（不重新编码，零画质损失）；需要缩放时输出 JPEG（q85），带 alpha 的 PNG 先压到白底再编码，避免透明区域变成黑块。HEIC/HEIF/TIFF 仍走 ffmpeg 转换路径。

响应 `Content-Type: image/jpeg`，ETag 由源文件的 mtime+size+渲染算法版本+目标档位派生；带 `If-None-Match` 命中时返回 `304`，不重复传图。条件判定在生成之前完成，冷缓存上的 304 也不必付出解码代价。预览图按源文件版本与档位分别缓存在 `derived/previews/`，可在设置页单独清理。带 `v` 且版本一致时响应 `Cache-Control: private, max-age=31536000, immutable`。

| 状态 | code                       | 含义                           |
| ---- | -------------------------- | ------------------------------ |
| 400  | `invalid_preview_width`    | `w` 不是正整数                 |
| 404  | `media_not_found`          | 源路径不存在或不再是普通文件   |
| 415  | `unsupported_image_format` | 不是受支持的图片，例如视频文件 |
| 500  | `preview_failed`           | 无法生成预览图                 |

### `GET /api/thumbs/:fileId?w=<像素宽度>&v=<内容版本号>`

返回 JPEG 渲染图。`w` 缺省 640，非数字或非正数返回 `400 invalid_render_width`；宽度会**向上对齐**到固定档位阶梯 320 / 640 / 1280 / 1920 / 2560 / 4096。视频尚无封面时返回 `404` 和 `code: video_cover_missing`。

源路径不存在或不再是普通文件时返回 `404 source_not_found`；先校验源类型，再查询内存/磁盘缓存或尝试抽帧，不将目录误报为 `video_cover_missing`。

纯 Go 解码器不支持的图片格式（HEIC/HEIF 等 iPhone 照片）优先用 ffmpeg 转换后生成缩略图；ffmpeg 不可用或转换失败时返回 `415 unsupported_format`，前端显示占位图而不是破图。

渲染图等比缩放到不超过目标宽度，不补边、不放大，因此返回的 JPEG 尺寸随源文件宽高比变化（例如 16:9 视频在 640 档返回 640×360，而不是补边后的 640×640）。前端按原始比例展示，不裁切画面。

档位阶梯是前后端共同的实现约定，不是配置项：同一张源图在各档之间宽高比一致，前端才能用 `srcset` 让浏览器按显示宽度与像素比自选档位。档位进缓存键与 ETag，因此换档就是换一份产物。

视频封面另有一层「母版」：服务端 ffmpeg 抽帧（或前端浏览器抽帧后上传）得到的原帧存为母版，母版宽 1280；各档渲染图从母版缩出，不按档位重复抽帧。母版比目标档位还窄时直接给母版，不放大。

### `POST /api/thumbs/:fileId/cover`

上传浏览器抽取的视频封面，body 为 JPEG/PNG 原始字节，最大 5 MiB。

源视频路径不存在或不再是普通文件时返回 `404 source_not_found`，不解码上传内容、不写入封面缓存。

### `GET /api/images/:fileId/info`

仅接受图片文件资源 ID，返回图片尺寸、格式、大小、修改时间和 checksum。`path` 为文件 ID，`name` 为文件名，`dir` 为所在目录的“根别名/相对父目录”，不包含文件名；根目录直属图片的 `dir` 只有根别名。例如 `name: "page.png"`、`dir: "素材/相册"`。

| 状态 | code                       | 含义                                 |
| ---- | -------------------------- | ------------------------------------ |
| 400  | `invalid_resource_kind`    | 传入根、相册或集合 ID                |
| 404  | `resource_not_found`       | ID 无效、已过期或不在当前媒体根中    |
| 404  | `media_not_found`          | 已收录的源路径不存在或不再是普通文件 |
| 415  | `unsupported_image_format` | 文件不是受支持图片，例如视频文件     |
| 500  | `image_info_failed`        | 无法读取或解码图片                   |

### `GET /api/videos/:fileId/info`

仅接受视频文件资源 ID，返回视频基础信息、可用时的元数据和转码状态。元数据优先通过 ffprobe 读取，缺失或失败时回退到 ffmpeg；两种工具都不可用时仍返回基础字段。回退结果的时长和码率遵循工具文本输出精度，未知数值以 0 表示，不返回 NaN 或无穷值。`path` 始终为文件 ID，`name` 为文件名，`dir` 与图片信息接口一致，只包含根别名和相对父目录。

| 状态 | code                       | 含义                              |
| ---- | -------------------------- | --------------------------------- |
| 400  | `invalid_resource_kind`    | 传入根、相册或集合 ID             |
| 404  | `resource_not_found`       | ID 无效、已过期或不在当前媒体根中 |
| 404  | `video_not_found`          | 视频源路径不存在或不再是普通文件  |
| 415  | `unsupported_video_format` | 文件不是受支持视频                |
| 500  | `video_info_failed`        | 无法读取文件信息                  |

### `POST /api/videos/info/batch`

批量返回视频基础信息、ffprobe 元数据和转码状态，避免视频列表为每个卡片
单独请求。请求体为 `{ "ids": ["f_...", "f_..."] }`，单次最多 100 个
文件 ID。响应为 `{ "ok": true, "items": [{ "id": "f_...", "info": {...} }] }`；
结果保留输入顺序及重复项。单项失败不返回 `info`，其 `code` 为
`resource_not_found`（ID 失效、路径含链接或不在当前媒体根中）、`invalid_resource_kind`（目录资源）、
`unsupported_video_format`（非视频）、`video_not_found`（源路径不存在或不再是普通文件）
或 `video_info_failed`（文件信息读取失败），不会使整批失败。
成功项的 `info.path`、`info.dir` 与单条接口采用相同的文件 ID 和父目录语义。

每项都按当前媒体根重新校验路径，拒绝扫描后被替换为符号链接或 junction 的目录，校验失败不会读取或探测该文件。服务未配置资源目录或路径校验器时返回 `500 video_info_unavailable`。

### 视频转码

- `GET /api/videos/:fileId/transcode/status`
- `GET /api/videos/:fileId/transcode/events`
- `POST /api/videos/:fileId/transcode/cancel`

转码状态查询（`/status`）、视频信息响应及进度流终态快照中的 `cached` 要求当前缓存仍为非空普通文件。已完成任务的缓存丢失、清空或变为非普通文件后，查询与重新订阅状态为 `failed`；下一次媒体请求可重新排队生成。目录占位导致发布失败时保持 `failed`，不删除占位目录。

`/events` 使用 SSE。排队与运行中的任务发送 `event: progress`，结束时发送一条 `event: done` 并关闭连接；事件 data 均为 `{ status, progress, etaSec, error? }`。`etaSec` 是按「已耗时 × 剩余比例」线性外推的剩余秒数估算；进度为 0、任务未开始或进度不足 0.5%（速率还不准）时为 0，表示未知；估算封顶 24 小时。没有活动任务时，按当前状态查询结果发送一条完整的 `done` 快照后关闭：磁盘缓存可用为 `cached`，原生可播放为 `not_needed`，工具不可用为 `unavailable`，需要转码但任务还没启动为 `pending`。迟到或重复订阅同样复核当前状态，不发送空对象作为终态，不因内存中缺少任务记录而误报缓存不可用。

`pending` 表示"这个视频需要转码，但转码任务还没开始"——转码由媒体请求按需触发，播放之前既没有缓存也没有在跑的任务。这不是故障：状态查询返回 `pending` 且不带 `error`，前端不应据此显示"转码失败"。缓存条目存在但无效（空文件或目录）仍报 `failed`。

任务与当前源文件大小、纳秒修改时间及转码 profile 关联；大小或修改时间变化后，查询和新订阅不沿用旧版本进度或错误，新媒体请求取消旧任务并按需启动当前版本。当前版本的有效磁盘缓存优先于内存任务状态，缓存恢复后可直接返回 `cached`。任务在启动或发布前发现源版本变化时，不发布该次产物，原任务进度流返回 `failed`，`error` 为 `video source changed`；下一次媒体请求按新版本处理。旧版本被新请求主动取消时，其原订阅仍收到取消终态。

## 收藏、历史与媒体活动

偏好文件只保存稳定资源 ID。加载时会丢弃不符合当前资源 ID 格式的记录，避免暴露本机路径。

偏好响应中的 `favorites`、`history` 以及清理响应中的 `removed` 始终为数组；没有条目时返回 `[]`，不返回 `null`。删除最后一个收藏、清空最近访问和无变化清理同样遵循此约定。

- `GET /api/prefs`、`PATCH /api/prefs`：读取或修改界面偏好。收藏与最近访问各有独立接口
  （`/api/favorites`、`/api/history`），不再混进偏好响应：客户端不必为此多存一份同样的数据。
  偏好文件本身仍带着这两项，备份因此是一个完整快照。
  `appMode` 是全局工作台模式，取值 `photo` / `comic`（缺省 `photo`），决定列表呈现哪一类相册；
  非法值返回 `400 invalid_app_mode`。两个模式互斥且完整覆盖媒体库：目录属性把媒体库分成
  照片与漫画两半，工作台一次只面对其中一半。
  `hiddenNavItems` 是侧栏里被收起的导航项 key 列表，存的是生效的清单：不在列表里的入口
  才显示在侧栏。key 形如 `photo.recents`、`comic.unread`，字符集限定为小写字母、数字、
  点与连字符；非法 key 返回 `400 invalid_nav_item`，超过 32 项返回 `400 invalid_nav_items`。
  服务端只保存与透传 key，不解释它的含义：新增导航项不必改后端，条目清单变了也不必
  迁移旧 key。缺省不收起任何一项（`hiddenNavItems` 为空数组）。
- `GET /api/favorites`：返回 `{ "favorites": ["<resourceId>"] }`。
- `POST /api/favorites`、`DELETE /api/favorites`：body 为 `{ "resourceId": "a_... | c_... | smart:<tag>" }`。
- `POST /api/favorites/prune`：按当前资源目录移除已失效相册/集合 ID，返回 `{ "removed": ["<resourceId>"] }`，不访问 ID 对应的文件路径；智能标签保留。资源目录尚未完成首次加载时返回 `409`，不会删除收藏。
- `GET /api/history`、`DELETE /api/history` 清空全部最近访问记录。
- `DELETE /api/history/:albumId` 幂等删除指定相册的最近访问记录，返回 `{ "ok": true, "removed": boolean }`；非法 ID 返回 `400 invalid_album_id`。
- `POST /api/history`：body 为 `{ "albumId": "a_...", "name": "...", "imageCount": 42 }`。

媒体活动使用复合标识：漫画阅读为 `albumId + mediaKind=image`，视频为
`albumId + mediaKind=video + itemId`。漫画页码与每个视频的播放位置互不覆盖。
照片浏览不留进度记录，因此没有 `mediaKind=photo`。

- `GET /api/activity?albumId=<albumId>&mediaKind=image`：读取漫画阅读活动。视频查询还必须传 `itemId=<fileId>`。
- `PUT /api/activity`：幂等写入单条活动。漫画 body 为 `{ "albumId": "a_...", "mediaKind": "image", "pageIndex": 12, "pageCount": 30 }`；视频 body 为 `{ "albumId": "a_...", "mediaKind": "video", "itemId": "f_...", "positionMs": 42000, "durationMs": 120000 }`。
- `POST /api/activity/query`：body 为 `{ "items": [{ "albumId": "a_...", "mediaKind": "image" }] }`，按精确标识批量读取，返回 `{ "activities": [], "count": 0 }`。
- `PUT /api/activity/batch`：body 为 `{ "activities": [...] }`，整批校验后一次原子落盘；单批最多 10000 条。
- `DELETE /api/activity?...`：幂等删除单条；`DELETE /api/activity/all` 清空全部图片和视频活动。

相同标识下，归一化后的位置与总数均未变化时保留原 `updated`，不写盘、不推进活动版本；单条写入响应返回实际保存的记录。批量请求也会跳过这些重复项，整批没有变化时不写盘。只有成功原子落盘后才确认有效变更。

`/api/library/activity-summary`、`/api/library/dashboard` 与 `/api/library/unread` 均按漫画阅读活动判定未读：有图片的漫画相册看它的 `image` 活动，纯视频的漫画相册改以是否存在视频播放活动为准——播放过就不再计入未读，避免视频相册永久停留在未读列表。前者用于常驻导航，仪表盘用于首页，专用分页端点用于完整未读列表。

未读与在读都属于漫画工作台的概念：照片目录下的相册不记录阅读进度，因此 `kind=photo` 时三个接口的未读计数恒为 0、`inProgress` 恒为空。仪表盘的 `inProgress` 只上报漫画相册的阅读页码。

响应中 `status` 为 `in_progress` / `completed`，由服务端按实际位置派生。图片到达
`pageCount - 1` 完成；视频到达 98% 完成。`/api/progress` 不提供。

图片 `pageIndex` 表示当前视图实际展示的最末页：单页模式为当前页，双页模式为跨页
右侧页，连续模式为可见区末页。读取不存在的记录返回 `404 activity_not_found`；标识或
数值非法返回 `400 invalid_activity_identity` / `400 invalid_activity`；持久化不可用返回
`500 activity_unavailable`。前端只把明确的 `activity_not_found` 当作新记录，其他错误
不会开放自动写入，避免恢复失败时覆盖已有位置。

## 精选（照片级）

精选与相册级收藏是两份数据、两种语义：收藏标记「这一本值得留着」（相册、集合或智能标签），
精选标记「这一张值得留着」（单个媒体文件）。两者互不覆盖，也不会互相清理 ——
「清理失效收藏」不会动精选，移出精选也不会动收藏。精选单独存放在
`<cacheDir>/state/picks.json`，上限 5000 条。

精选只属于照片工作台：照片墙与精选页都是照片侧的界面，漫画那边有阅读进度与已读状态，
不需要另一套「这一张值得留着」。

- `GET /api/picks`：返回 `{ "ok": true, "picks": ["f_..."], "total": 3, "revision": 7 }`。
  `picks` 是精选的文件 ID，最近加入的排在最前面；`revision` 在每次成功写入后递增。
- `POST /api/picks/batch`：body 为 `{ "ids": ["f_..."], "action": "add" | "remove" }`，
  响应 `{ "ok": true, "updated": 2, "total": 5, "revision": 8 }`。加入是幂等的，
  移出对本来就不在精选里的条目没有影响；`updated` 是实际变化的条数。单批最多 1000 项，
  标识不是合法文件 ID 时返回 `400 invalid_picks_batch`，超过上限返回 `400 pick_limit`。
- `GET /api/picks/media?limit=60&cursor=...`：分页返回精选照片本身，跨相册。
  每项是媒体项加上 `albumId` 与 `albumName`（它属于哪本相册），并带 `picked: true`。
  文件被移出媒体库后它自然从这一页消失：精选说的是「库里的照片」，不是对磁盘路径的承诺。
  漫画相册里的文件不进这一页。

精选页的分页游标作用域里带精选自身的 `revision`：精选一变，旧的游标立即返回
`400 invalid_cursor`，客户端从第一页重取。这样新加入的照片不会把已经翻过的页顶走一格。

## 缓存与系统操作

- `GET /api/cache/stats`：返回脱敏缓存名称、占用和文件数。除总占用 `totalBytes` / `fileCount` 外，按子目录给出 `thumbs`（缩略图）、`converted`（HEIC/HEIF/TIFF 的整图转换产物）、`previews`（阅读器按宽度缩放的预览图）、`videoFaststart`、`videoTranscode` 五项细分。`totalBytes` 统计的是整棵 `derived/` 子树（含 AI 分析产物与媒体尺寸缓存），五类细分之和不等于它；`mediaBytes` / `mediaFileCount` 才是这五类媒体派生缓存的和。子目录尚不存在时该项 `available=false`、`bytes`/`fileCount` 为 0。
- `POST /api/thumbs/cleanup`
- `POST /api/cache/clear?scope=thumbs|converted|previews|faststart|transcode|all`：统一清空入口，按 scope 删 thumbs / converted / previews / faststart / transcode 缓存中对应的一类；scope=all 同时清理五类派生缓存和视频元数据内存摘要。响应 `{ scope, thumbs?, converted?, previews?, faststart?, transcode?, totalDeleted, totalFreedBytes }`，未涉及的 scope 字段省略。删除数量与释放字节只统计磁盘文件，不包含内存摘要。
- `POST /api/cache/rebuild`：启动一次后台重建，请求体 `{ scopes: ["thumbs","previews"], previewWidth?: number }`。响应 `{ ok, jobId, reused, scopes, previewWidth }`；已有任务在跑时复用它（`reused=true`）。范围只接受 `thumbs` 与 `previews`，其它值返回 `400 invalid_rebuild_scope`，空范围返回 `400 missing_rebuild_scope`。
- `GET /api/cache/rebuild/:id`：返回重建进度快照 `{ jobId, status, scopes, total, done, failed, elapsedMs, error? }`。`status` 取 `pending` / `running` / `complete` / `cancelled` / `error`。未知 jobId 返回 `404 rebuild_not_found`。
- `GET /api/cache/rebuild/:id/events`：重建进度的 SSE 流，事件名与任务状态同名（`pending`/`running`/`complete`/`cancelled`/`error`），data 为上述快照；终态事件后连接关闭，每 15 秒发一次注释心跳。`running` 事件在任务运行期间每 500ms 推一次快照，进度条不会停在起点；终态事件带最终计数。
- `DELETE /api/cache/rebuild/:id`：取消正在进行的重建。任务已结束时返回 `{ ok: true, alreadyDone: true }`。

重建把渲染图与预览图提前算好，免得清空之后每次打开页面都要在请求里现算。
缩略图档按用途取：相册封面额外生成最小档（320），其余照片只生成 640；预览图按
`previewWidth`（缺省 1280，对齐到档位阶梯）生成。视频封面要靠 ffmpeg 抽帧，不参与
批量重建。重建只覆盖派生缓存，不会碰 `state/`。
- `POST /api/fs/open`：本机接口，body 为 `{ "id": "<resourceId>" }`。执行前按当前媒体根重新校验路径；根、集合和相册必须仍为目录，文件必须仍为普通文件。
- `GET /api/admin/fs/open?path=<configuredPath>&allowConfig=1`：设置页专用，仅允许打开已配置路径且只接受回环请求。

系统打开操作有副作用，前端不自动重试请求；配置目录打开的 GET 同样不缓存响应。

`POST /api/fs/open` 拒绝扫描后出现在根内路径中的符号链接或 Windows junction，`allowConfig` 查询参数不能豁免该资源校验。主要错误如下：

| 状态 | code                                         | 含义                                                              |
| ---- | -------------------------------------------- | ----------------------------------------------------------------- |
| 400  | `invalid_resource_id`                        | 缺少 ID 或请求体非法                                              |
| 403  | `os_open_disabled` / `local_access_required` | 系统打开未开启或请求来自远程                                      |
| 404  | `resource_not_found`                         | ID 无效、已过期、路径不在当前根中、含链接、资源不可用或类型已变化 |
| 500  | `os_open_failed`                             | 校验或系统打开依赖不可用，或系统打开执行失败                      |

### `POST /api/admin/fs/directories`

设置页的目录选择接口，沿用 `AccessGate` 的认证、Host 和同源校验，且额外要求回环地址；LAN 认证成功的远程客户端仍返回 `403 local_access_required`。不受 `allowOsOpen` 控制，不会启动系统文件管理器。

请求体为 `{ "directory": "<目录路径>", "after": "<上一页游标>" }`。两字段可省略：空目录从服务进程用户的主目录开始，空游标读取第一页。相对路径按服务进程 CWD 解析，成功结果返回规范化、解析链接后的完整路径。该接口有意允许浏览媒体根之外的目录，供新增媒体根、缓存和静态资源配置使用。

```json
{
  "directory": "/home/user/photos",
  "parent": "/home/user",
  "roots": ["/"],
  "items": [{ "name": "旅行", "path": "/home/user/photos/旅行" }],
  "nextAfter": ""
}
```

`roots` 为 Windows 逻辑盘根列表，或 macOS/Linux 的 `/`；文件系统根的 `parent` 为空。仅返回直属目录，跳过普通文件和目录链接；按目录名的 UTF-8 字节序升序，每页最多 200 项。`nextAfter` 非空时用原值请求下一页；为空时已到末页。分页使用实时文件系统视图，目录发生变化后可重新前往该目录刷新。响应 `Cache-Control: no-store`，完整路径只用于设置组件的临时状态，不写入浏览器持久化 store；请求路径放在 JSON body 中，访问日志不记录 body。

| 状态 | code                        | 含义                                  |
| ---- | --------------------------- | ------------------------------------- |
| 400  | `invalid_directory_request` | 请求体非法、路径含 NUL 或目标不是目录 |
| 403  | `directory_access_denied`   | 服务进程没有读取目录的权限            |
| 404  | `directory_not_found`       | 目录不存在或离线                      |
| 500  | `directory_read_failed`     | 目录读取失败，错误信息不包含完整路径  |

浏览、翻页和取消不修改文件或配置。确认选择后，前端把返回的完整路径提交给现有 `PUT /api/config`；媒体根沿用停止输入 450ms 后保存，缓存与静态目录立即保存并保留需重启提示。

### 媒体目录离线与初始设置

服务启动和配置重载只校验运行参数，媒体根暂时离线或 mediaRoots: [] 不阻止访问设置页。显式 PUT 修改 mediaRoots 时校验每个非空目录存在且为目录；空数组表示主动清空配置。只修改其他设置时不检查旧媒体根是否在线。空白路径会被忽略，不会解析到进程工作目录。扫描仍要求本轮所有根可访问；失败保留上次已发布快照，不将离线目录当作删除。不支持部分根扫描发布。


### 浏览列表查询

`GET /api/library/overview` 在服务端筛选、排序后分页，首页、集合和标签页共用。

- `kind=photo|comic` 必填；`parent` 指定根/集合，`tag` 指定标签，两者互斥，均省略时查询首页各根直属节点与智能标签（首页隐藏虚拟相册）。标签放查询参数，由框架解码一次，字面 `+`、`%xx` 由客户端编码保留。
- `view=all|album|collection|smart`，默认 `all`；`q` 匹配标题和标签；`year=1900..2099|other` 按标题提取年份；`minImageCount` 非负且只约束相册。
- `sort=name|count|added|recent|viewed` 默认 `name`，依次为自然名称、数量降序、业务日期降序、修改时间降序、相册访问时间降序。同值按名称及稳定 ID 排列。
- `excludeYearTargets=1` 把按年份归组的代表节点从列表里去掉。首页的年份索引直接给照片墙看，那些集合不必在列表里再出现一次：同一批内容摆两处，用户只会以为看错了。只在顶层范围生效；一旦带搜索词或年份筛选，列表仍给出全部命中。
- `limit` 沿用分页默认值与上限，`cursor` 是不透明游标，绑定全部查询条件、库 revision，以及 `viewed` 排序使用的历史快照。变更后返回现有 `invalid_cursor` 或 `stale_cursor`，客户端清空分页链重取首屏。非法筛选返回 `400 invalid_library_query`。
- 响应 `{ok:true,page:{revision,items,total,nextCursor?,counts,scopeCounts,years,series,imageTotal,videoTotal,latestModified,completedCount}}`。`items` 是 `{kind:"album"|"collection",node:节点摘要}` 或 `{kind:"smart",tag:标签摘要}`；`counts` 在应用所有其他筛选但尚未应用 `view` 时计数；`scopeCounts`、`years`、`series` 和媒体总量来自未筛选的完整作用域，不随已加载页数变化。
- `years` 每项包含年份、直属项数、图片/视频总量、代表入口与封面；`series` 包含作品 ID、名称、卷数与封面；`completedCount` 是漫画标签全部成员中的已读数。响应不携带本机绝对路径。

### 跨相册照片流

`GET /api/library/media-feed` 返回跨相册的照片序列：每张照片带它来自哪本相册，用户不必先认准是哪一本才能看到那些照片。

- `kind=photo|comic` 必填，与其它列表接口同义。
- `scope` 必填，决定从哪里取材：
  - `year` —— 取某个年份下各相册的照片。`year` 必填，取 `1900..2099` 或 `other`（没有年份的那一桶）。年份口径与 `overview` 的年份分组一致：取直属节点名里第一处 `19xx` / `20xx`；年份分组里的集合会展开成它内部的所有相册，集合里的散图（"本目录媒体"）也算在其中。
  - `collection` —— 取某个集合内部所有相册的照片，`parent` 必填且必须是集合 ID。
  - `recent` —— 取最近加入的几本相册里的照片。
  - `random` —— 取随机几本相册里的照片。相册按年份分桶后轮流取（同一年份最多两本），一本相册里的照片则等距抽样而不是取连续的一段：连着看同一场活动的连拍，墙上就只剩一种口味。`seed` 可选：同一个种子给同一批照片，不同种子给不同的批次（「换一批」因此一定换得掉）。
  - `stream` —— 取一条确定的长流：瀑布流专页往下滑的数据源。相册按种子打散、相册内部的照片也按种子打散，按「每轮每本相册十二张」逐轮往下取。游标是长流里的照片下标，同一颗种子给出同一条长流，因此翻页与重进都接得上。走完一圈（全库每张照片各一次）会绕回开头再来一圈，绕圈时相册内的顺序重新打散：照片会再出现，但不会按同一个次序再出现。`seed` 必填语义与 `random` 相同。
  - `timeline` —— 取全库按单张媒体的日期证据排下来的序列（只属于照片侧），优先级为 EXIF → 文件名 → 有效目录日期 → 该文件的修改时间。只有文件修改时间的媒体排在末尾并单独成段。`year` 可选（`1900..2099`，或 `unknown` 表示「日期未知」那一段），`month` 可选（`1..12`，必须与 `year` 同时给；只有年份证据的媒体不属于任何月份），`media` 可选（`photo` / `video`，缺省两类都收）。换筛选条件后旧游标立即失效（作用域里带着筛选标记与实际索引版本）。库 revision 变化立即重建索引；仅分析记录 revision 变化允许 10 秒防抖，并且只在同一库快照上复用旧索引。
- `limit` 沿用分页默认值与上限，`cursor` 是不透明游标，绑定取材条件与库 revision。`year` 与 `collection` 分页；`stream` 按游标分页；`recent` 与 `random` 一次返回整批，不分页。
- 响应 `{ok:true,page:{revision,items,total,nextCursor?,albums,sources}}`。`items` 是媒体字段加上 `albumId` / `albumName`；`scope=timeline` 时每一项另带 `dateSource`（`exif` / `filename` / `folder` / `modified`）、`datePrecision`（`day` / `month` / `year` / `unknown`）与按精度表达的 `dateValue`（`YYYY-MM-DD` / `YYYY-MM` / `YYYY`）。精确到日的媒体保留旧字段 `capturedAt`（RFC3339）；仅年月或年份不返回 `capturedAt`，避免旧客户端把内部排序锚点显示成一月一日。修改时间可继续由 `capturedAt` 提供排序值，但必须遵守 `datePrecision=unknown`，不得当作拍摄日期显示。整页另带 `years`（年份索引 `{year,count,months:[{month,count}]}`；只有年份证据时计入 `count`，不伪造月份）、`unknown`（全库当前 `media` 类型的日期未知数量，不随年份/月筛选变化）、`dateSources` 与 `datePrecisions`（当前筛选结果按来源和精度分别计数）。`albums` 的 `{id,name,count}` 统计当前筛选结果中各来源相册的媒体数，跨页保持一致；`sources` 是取材范围里被选中的节点 `{id,name,kind}` —— 年份对应的那几个集合，或集合页的那一个集合。
- `scope=collection` 的照片按相册轮流排列（第 0 轮取每本相册的第 1 张，第 1 轮取每本的第 2 张……）：连着看一本相册的头几张，看到的只是这一本，轮流取之后每一本都露得出来。
- `recent` 与 `random` 会把几本相册的照片交错排布：连着看一本相册的头几张，墙上就只剩一种口味。
- 非法取材条件返回 `400 invalid_media_feed`；集合 ID 不存在返回 `404 resource_not_found`，类型不对返回 `400 invalid_resource_kind`。响应不携带本机绝对路径。
