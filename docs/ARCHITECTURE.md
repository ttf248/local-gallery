# Local Gallery · 系统架构

本文件维护当前系统的模块边界、数据流、安全模型、媒体与本地分析管线、本地存储布局及前端状态架构。HTTP/SSE 接口详情见 [API.md](./API.md)，产品结构见 [PRODUCT.md](./PRODUCT.md)，设计系统与验收见 [DESIGN.md](./DESIGN.md)，运行与验证命令见根 [README.md](../README.md)。

---

## 1. 系统概览与模块边界

Local Gallery 采用**单 Go 进程 + 本地文件/JSON 持久化 + React 浏览器单页应用**架构，可选拉起本地常驻 Python AI Worker 完成推理任务，不引入数据库、消息队列或反向代理。开发期由 Vite 将 `/api` 代理至 Go 服务，生产期由 Fiber 单端口托管 API 与前端静态构建产物。

```text
React Routes / Features ──► api/* + TanStack Query（服务端状态）
                        ──► store/* (Zustand，客户端 UI 与临时会话状态)
        │  资源 ID / JSON / SSE
        ▼
Fiber Middleware（AccessGate → PathSafety / ResourceParam）
        │
        ▼
Handlers ──► Services / Store ──► Models + 本地只读媒体目录 / cacheDir
                    │
                    └──► 可选子进程：Python AI Worker（stdin/stdout JSON Lines）
```

### 核心目录职责

| 路径 | 职责 |
| --- | --- |
| [`backend/cmd/server/`](../backend/cmd/server/) | 进程入口：解析 `--config`、装配配置、服务、中间件、路由、静态资源托管与优雅退出 |
| [`backend/internal/config/`](../backend/internal/config/) | YAML 加载与默认值、参数校验、串行热更新写盘、权限收紧（Unix `0600` / Windows 受保护 DACL）与变更订阅 |
| [`backend/internal/pathutil/`](../backend/internal/pathutil/) | 跨平台媒体根规范化、大小写等价比较与最具体根归属匹配 |
| [`backend/internal/middleware/`](../backend/internal/middleware/) | 访问门禁（Host / Origin / Local / LAN 会话）、回环限制、资源 ID 解析与实时路径校验、日志与恢复 |
| [`backend/internal/handlers/`](../backend/internal/handlers/) | HTTP/SSE 请求校验、响应序列化、条件缓存协商与机器可读错误码 |
| [`backend/internal/services/`](../backend/internal/services/) | 扫描与增量同步、不可变资源快照与分页索引、媒体/缩略图/视频管线、本地 AI 任务与各类派生索引、状态备份 |
| [`backend/internal/store/`](../backend/internal/store/) | 偏好/收藏/历史、媒体活动与照片精选的并发安全原子落盘存储 |
| [`backend/internal/models/`](../backend/internal/models/) | 前后端领域模型及受支持媒体扩展名唯一白名单（`ImageExts` / `VideoExts` / `FileMediaKind`） |
| [`backend/aiworker/`](../backend/aiworker/) | Python 3.11 常驻推理 Worker（`worker.py` / `worker_imageio.py`）、模型校验下载与评测脚本 |
| [`frontend/src/`](../frontend/src/) | 分层 React 应用：`app/`、`ui/`、`shell/`、`features/`、`routes/`、`api/`、`hooks/`、`store/`、`utils/`、`styles/` |

依赖方向严格单向：`cmd/server → handlers → services/store → models`；`services` 与 `store` 不依赖 Fiber。

---

## 2. 资源快照、ID 体系与安全边界

### 不可逆资源 ID 与不可变快照

- `ResourceCatalog` 是将本地绝对路径转换为公共资源 ID 的唯一组件，前缀分别为 `r_`（媒体根）、`a_`（相册/卷）、`c_`（集合/文件夹/作品）与 `f_`（媒体文件）。ID 由根标识、资源类型与相对路径稳定派生，路径不变时保持不变且无法逆推本机路径。
- 每次扫描发布都会一次性构建目录直属子项、自然排序媒体表、标签索引、搜索索引、文件反查表与漫画派生元数据，并通过一次原子指针切换发布为新的 `revision`。
- 每个 HTTP 请求仅 `Acquire` 一次 `CatalogSnapshot` 并固定在 Fiber Locals 中，保证单次请求读取一致视图。分页游标带签名并绑定 `revision`、内容属性（`photo`/`comic`）及查询作用域；重扫后过期游标返回 `409 stale_cursor`，跨模式或篡改游标返回 `400 invalid_cursor`。

### 多层访问控制与实时路径校验

请求先通过 `AccessGate`，再进入资源解析与 `PathValidator`：

1. **Host 与跨源防线**：所有模式均校验 `Host`、`Origin` 与 Fetch Metadata，阻断 DNS Rebinding 与跨站请求伪造。
2. **local / LAN 认证边界**：
   - `accessMode: local`（默认）：仅放行回环来源请求，即使 `host` 绑定局域网地址也不放行远端 API。
   - `accessMode: lan`：除最小健康检查与会话端点外，所有 API 均须携带 `Authorization: Bearer <token>` 或经 `/api/auth/session` 换取的 8 小时 `HttpOnly; SameSite=Strict; Path=/api` 会话 Cookie（不接受 URL query 传令牌）；轮换 `accessToken` 立即作废内存中的所有旧会话。内置服务不终止 TLS，LAN 模式仅适用于可信家庭网络。
   - 配置管理（`/api/config`）、本机目录浏览（`/api/admin/fs/*`）、绝对路径查询（`/api/storage/paths`）、状态备份恢复（`/api/admin/state/*`）与人物标注导出（`/api/admin/people/annotations/*`）额外受 `LoopbackOnly` 保护，LAN 远程客户端一律返回 `403 local_access_required`。
3. **实时路径边界重验**：资源 ID 不等同于授权凭据。每次媒体发送、缩略图渲染、批量探测及系统打开请求都必须经过 `PathValidator` 按当前配置根重新核验：
   - 按最具体配置根授权（与根配置顺序无关），失败不回退至更宽父根。
   - 显式配置为媒体根的符号链接/junction 可作为边界，根内未单独配置的符号链接/junction 一律拒绝。
   - 逐级检查目录组件与最终文件类型（文件须仍为普通文件，目录须仍为目录），检查先于 ETag / 304 / Range 与缓存查找。

---

## 3. 扫描、库发布与自动文件同步

### 目录扫描与发布流程

1. **路径规范化**：`NormalizeRoots` 将相对路径按进程 CWD 绝对化、去空并按平台大小写规则去重（Windows 忽略大小写，Unix 区分），不提前解析符号链接，确保离线根仍可做配置与缓存比对。
2. **单例扫描与容错**：`AsyncScanRunner.StartOrReuse` 全局复用单一活动扫描；启动及提交前复核各根存在性与身份，任一根缺失、不可读或被替换则整轮失败并保留旧快照与旧缓存。可读的空根合法，普通子目录读取失败或未配置符号链接记入脱敏 `warnings`。
3. **有界并发工作池**：`Scanner` 使用 `min(8, NumCPU)` 固定目录 worker，由协调器派发子目录，避免深层递归占用 goroutine 造成死锁；遇到含普通文件 `.nomedia` 的目录跳过整个子树；父根遇到独立配置的子根时委派给子根，归属不重复统计。
4. **虚拟相册与时间证据**：既含子目录又含直属媒体的混合目录同时生成集合节点与「本目录媒体」虚拟相册（`virtual: true`，用相对路径 `location` 区分）。相册业务日期在扫描期按 `filename > folder > modified` 推导（不读 EXIF，避免随机 I/O），并同步记录单文件修改时间供时间线降级使用。
5. **原子发布与恢复缓存**：发布前统一叠加有效的用户自定义封面与已计算的智能选封评分，校验扫描 generation 后原子切换快照，并经 500ms 防抖落盘至 `state/scan_cache.json`（不匹配当前根集合或 schema 版本时自动隔离冷启动）。SSE 订阅每连接独立缓冲、每 15 秒发送注释心跳，客户端断连仅释放订阅，不取消共享扫描任务。

### 实时监听与增量同步（`LibrarySyncService`）

- **目录监听（`ChangeWatcher`）**：基于 `fsnotify` 监听有效媒体目录（自动跳过排除规则、`.nomedia`、独立子根与符号链接），上限 `10,000` 个目录以限制 Windows 句柄与事件缓冲区占用。
- **去抖与写完判定**：事件经 2 秒静默窗口合并（最长等待 30 秒），并对持续增长的文件推迟提交，避免索引写到一半的媒体。
- **增量扫描（`IncrementalEngine`）**：复用上一份扫描结果树，仅重读变动目录并重建受影响祖先；通过聚合文件大小与纳秒修改时间的相册 `contentSignature` 区分「结构变化」与「原地内容覆写」。离线根保留旧内容不误删，无实质变化不递增 `revision`。
- **分析联动与兜底校验**：若开启 `autoAnalyze`，按每批至多 500 张将变动照片排入现有 `AIJobService`（超出 5,000 上限时自动切换全库增量分析），待全部模块完成后触发智能相册增量刷新；欠账状态持久化至 `state/library_sync.json` 以便重启接续。启动后 15 秒及此后每 30 分钟执行一次兜底校验扫描。

---

## 4. 媒体处理管线

### 图片渲染、档位与缓存协商

- **固定宽度渲染阶梯**：`rendition.go` 定义 `320 / 640 / 1280 / 1920 / 2560 / 4096` 六档宽度（与前端 `utils/rendition.ts` 保持一致）。请求宽度向上对齐到档位，缩放保持原图宽高比不裁剪，前端 `RenditionImage` 结合 `srcset` / 舞台尺寸自动挑档。
- **版本号与零解码 304**：`MediaVersion` 由源文件 `<mtime_ns>-<size>-r<算法版本>` 派生。渲染图强 ETag 为 `"<version>-<width>"`，条件请求判定先于解码执行；携带匹配 `?v=<version>` 时返回 `Cache-Control: private, max-age=31536000, immutable`，否则返回 `private, no-cache`。
- **像素内存预算与大图兜底**：并发受 `min(12, NumCPU)` 与 `192 MP` 加权像素信号量双重约束；超预算巨幅图片优先经 FFmpeg 预缩放后再解码，避免 OOM 或挂死。HEIC/HEIF/TIFF 通过可选 FFmpeg 转换至 `derived/converted/`。
- **坏图标记与缓存重建**：读文件头失败或渲染解码失败（如截断 JPEG）记入 `MediaDimensionService`（`derived/media_dimensions.jsonl`，按页攒批落盘），前端明确标示「无法解码」。`CacheRebuildService` 支持后台预热缩略图与预览图并经 SSE 推送进度。

### 视频封面、元数据与流式转码

- **封面抽取**：优先由服务端 FFmpeg 抽取宽 `1280` 母版帧并派生各档渲染图（同文件合并、全局最多 2 并发）；无 FFmpeg 时前端经 Range 抽帧并 `POST /api/thumbs/:id/cover` 回填。
- **视频元信息（`VideoInfoService`）**：优先 `ffprobe` JSON，回退 `ffmpeg` 输入头解析；按规范路径、大小与纳秒修改时间缓存至 512 项内存 LRU，同指纹 `singleflight`。
- **三级发送管线**：按「按需转码 H.264+AAC（MKV/AVI/3GP 或冷门编码）→ MP4 faststart 重封装 → 原文件」择优发送。转码任务按源指纹与 profile 去重，独占临时文件写完校验后原子发布。原图与视频统一由 `serveMediaFile` 独立打开文件句柄流式传输，完整支持单段 `Range`、`If-Range` 与弱/强 ETag 协商。

---

## 5. 本地分析引擎与派生索引

### 分析任务系统（`AIJobService`）

所有后台分析共享同一持久任务队列（同一时刻仅运行 1 个活动任务，其余有序排队，状态持久化至 `state/ai_jobs.json`），按 `32` 张一批原子提交至 `derived/metadata/<module>/batches/<jobId>/`，支持暂停、恢复、取消、失败重试、每日计划调度与进程重启续跑。

| 模块类型 | 中文名称 | 处理范围 | 运行方式 | 主要产物 |
| --- | --- | --- | --- | --- |
| `metadata` | 照片元数据 | 全库图片 | Go 内置（CPU） | EXIF 拍摄时间、相机参数、GPS 坐标 |
| `embedding` | 向量索引 | 全库图片 | Python Worker（Chinese-CLIP ViT-B/16，512 维） | `derived/ai/vectors/` Float16 分片索引 |
| `ocr` | 文字识别 | 全库图片 | Python Worker（RapidOCR PP-OCRv6） | 文本/框批次 + `derived/ai/ocr-search-index.json` |
| `face` | 人脸识别 | 照片侧图片（需开启人物分析） | Python Worker（`quality-v2` 128 维 / `buffalo_m` 512 维） | 按模型隔离的批次与人物索引 |
| `portrait` | 精选人物头像 | 已分组人物照片 | Python Worker（复用当前人脸模型） | 正脸清晰度评分与眼位裁切框 |
| `similarity` | 相似照片特征 | 照片侧图片 | Go 内置（CPU） | SHA-256、pHash/dHash、裁切哈希、清晰度/曝光质量分 |
| `albumCover` | 相册封面精选 | 照片侧图片与视频 | Python Worker（Aesthetic V2.5）+ FFmpeg | 审美 60% + 画质 40% 评分与候选封面 |
| `comicCover` | 漫画封面精选 | 漫画每卷最多抽样 5 页 | Python Worker（Aesthetic V2.5）+ dHash 去重 | 作品与单卷智能选封排序 |
| `comicMeta` | 漫画内容识别 | 漫画作品与散卷代表页 | RapidOCR + 本地元数据（可选 Bangumi 在线匹配） | `derived/comic/intel.json` 规范书名/作者/大纲 |

- **统一失效判据**：空闲规模预估（`AIJobService.Estimate`，8 并发 stat，30 秒 revision 缓存）与任务实际执行共用 `aiRecordIsCurrent`（比对字节大小、纳秒修改时间、模块版本及已知逐文件解析失败记录），确保估算数与实际 `planned` 一致。
- **硬件与 Python Worker 运行时**：
  - 源码环境使用独立 `backend/aiworker/.venv`（Windows/Linux 支持 CUDA，macOS 使用 CPU）；Windows 便携包使用内置 `aiworker/runtime/` 并通过 DirectML 优先调用 GPU、无可用适配器时自动回退 CPU。
  - Go 与 Worker 经 stdin/stdout JSON Lines 通信（响应原样回传请求 ID，避免单次失败拖垮整批），所有权重仅从 `<cacheDir>/derived/ai/models/` 读取并校验 SHA-256，不在服务启动时隐式联网下载。
  - 向量索引以 512 维 Float16 分片存储，累计 128 个未压实分片后后台自动压实（每片至多 512 条），检索使用半精度解码查表与有界 Top-K 堆。OCR 倒排索引支持全半角/标点/断行归一化与中文长短语受限容错匹配。

### 人物聚类、智能相册与相似整理

- **人物服务（`PeopleService`）**：`quality-v2`（YuNet + SFace，128 维）与 `buffalo_m`（SCRFD + ResNet50，512 维）各自隔离记录、HNSW 索引（`derived/ai/people-index-<model>.json`）与人工修正（`state/people-<model>.json`），禁止跨模型比较。聚类使用在线中心余弦（≥ `0.520`）+ 固定锚脸余弦（≥ `0.720`）防止链式漂移，任务批次期间增量追加，收尾整体重建并按重叠迁移人工修正；未确认稀疏组由独立「待确认匹配」召回并输出中文风险原因；合照判定门槛为 `>20` 张脸或 `≥8` 张脸且中位相对脸宽 ≤ `4%`。
- **人物标注工作台（`PeopleAnnotationService`）**：数据独立存放在 `state/people-annotations.json`，可导出 `schemaVersion: 1` 本地评测集供 `backend/aiworker/evaluate_people.py` 与 `backend/cmd/people-eval` 离线评测，不改动线上人物分组。
- **智能相册（`SmartAlbumService` + `SmartAlbumRefreshService`）**：针对单本照片相册构建时间、地点、人物、场景四类详细分组（≥3 张），并综合多维证据生成精选主题（≥12 张、质量分 ≥ `0.82`、控制重叠度）；分组成员缓存在 `derived/ai/smart-albums/`，人工改名与隐藏保存在 `state/smart_album_overrides.json`（分组换号时采用「先写新键 → 缓存落盘 → 再删旧键」两步迁移）。全库刷新由后台单任务执行，手动触发与每日计划共用。
- **相似照片整理（`SimilarityService`）**：完全重复按全库 SHA-256 分组；近似重复在文件夹内使用 8 段 8 位分带索引召回（保证汉明距离 ≤7 必召回）并结合多档中心裁切哈希与可选语义向量否决线复核；连拍按 90 秒拍摄窗口与相似度聚合且不视作重复。派生分组存于 `derived/ai/similarity/groups.json`，人工状态与代表选择存于 `state/similarity.json`（重建时按类别、成员重叠与锚点迁移决定）。

### 离线地理与足迹

- **双精度内嵌边界**：
  - 点位匹配：`backend/internal/services/geodata/china-admin.geojson.gz`（省 34 / 市 335 / 区县 2,845，共 3,214 要素，GCJ-02 坐标系），服务启动时后台预热并按纬度分桶加速点在多边形判定。
  - 前端绘图：`backend/internal/services/geodata/china-admin-outline.geojson.gz`（经 `scripts/simplify_china_outline.py` 按省 `0.01°` / 市 `0.004°` / 区县 `0.002°` 简化），按需分省/市/区划码下发且长期缓存。
  - 数据源来自 [AreaCity-JsSpider-StatsGov `2025.251231.260403`](https://github.com/xiangyuecn/AreaCity-JsSpider-StatsGov/releases/tag/2025.251231.260403) 的 `ok_geo.csv.7z`（更新脚本见 `scripts/update_china_boundaries.py`）；上游未为边界文件单列开源许可证，商业使用或再分发前须向上游核实授权。
- **隐私与时间口径**：EXIF WGS84 坐标在本机转 GCJ-02 匹配，接口不返回单张照片经纬度；点云接口仅输出六档粗网格（`0.01°`–`0.5°`，默认 `0.2°` 用于足迹小图）的格心与计数。到访按 EXIF 当地日历日间隔 ≤ `2` 天归并，行程默认按 `14` 天间隔切分。

### 照片时间线与漫画元信息

- **照片时间线（`PhotoTimelineService`）**：索引仅保存 `(相册 ID, 下标, 排序时间, 来源, 精度, 规范日期)`，不复制媒体摘要；单张证据按 `EXIF > filename > folder > modified` 独立计算，仅修改时间归入末尾「日期未知」。索引版本由 `(catalog revision, analysis revision)` 构成，游标绑定索引 epoch 与筛选条件。
- **漫画元信息（`ComicMetaService`）**：扫描发布时解析规范书名、话号、别名与正篇/番外计数，并安全读取同目录至多 64 KiB 的 `ComicInfo.xml`、`series.json` 或 `info.json`；人工覆盖保存在 `state/comic_overrides.json`，开启 `comicMeta.onlineEnabled` 后才串行限速查询公开源（Bangumi，仅发送清洗书名）。

---

## 6. 配置与本地存储布局

未配置 `cacheDir` 时默认位于进程工作目录下的 `.local-gallery/`，严格划分**不可重建用户状态（`state/`）**、**可重建派生缓存（`derived/`）**与**临时目录（`temp/`）**：

| 路径（相对 `cacheDir`） | 内容 | 可否重建 |
| --- | --- | --- |
| `state/web_settings.json` | 收藏、浏览历史与服务端偏好（主题、侧栏、导航隐藏项、`appMode`） | 不可 |
| `state/activity.json` | 漫画按页阅读进度与视频播放位置 | 不可 |
| `state/picks.json` | 照片级精选集合（上限 5,000 条） | 不可 |
| `state/cover_overrides.json` | 用户手动设置的相册/作品封面 | 不可 |
| `state/comic_overrides.json` | 漫画作品人工元信息覆盖与锁定状态 | 不可 |
| `state/people-<model>.json` | 按模型隔离的人物命名、隐藏、合并/拆分与手选头像 | 不可 |
| `state/people-annotations.json` | 本地人物评测标注进度 | 不可 |
| `state/smart_album_overrides.json` | 智能相册自定义名称与隐藏状态 | 不可 |
| `state/similarity.json` | 相似照片处理状态、忽略与指定代表 | 不可 |
| `state/ai_jobs.json` | 分析任务队列、历史、检查点、硬件偏好与每日计划 | 不可 |
| `state/library_sync.json` | 文件监听开关、最近同步结果与未完成自动分析标记 | 不可 |
| `state/scan_cache.json` | 重启免扫描恢复缓存（普通派生缓存清理不触及） | 可重扫 |
| `state/backups/` | 用户执行状态恢复前自动生成的回滚前快照 | 不可 |
| `derived/thumbnails/`、`converted/`、`previews/` | 缩略图、格式转换图、阅读器预览图 | 可重建 |
| `derived/video-faststart/`、`video-transcode/` | 视频 faststart 与 H.264+AAC 转码缓存 | 可重建 |
| `derived/media_dimensions.jsonl` | 图片原始像素宽高与坏图标记缓存 | 可重建 |
| `derived/metadata/<module>/` | EXIF、OCR、人脸（按模型）、相似特征、封面、漫画分析批次 | 可重建 |
| `derived/ai/models/` | 经 SHA-256 校验的本地 AI 模型权重 | 可重下 |
| `derived/ai/vectors/` | 512 维 Float16 语义向量分片与 manifest | 可重建 |
| `derived/ai/ocr-search-index.json` | OCR 倒排检索索引 | 可重建 |
| `derived/ai/people-index-<model>.json` | 按模型隔离的可重建人物聚类索引 | 可重建 |
| `derived/ai/smart-albums/` | 按相册与维度缓存的智能分组 | 可重建 |
| `derived/ai/similarity/groups.json` | 可重建的相似与连拍分组结果 | 可重建 |
| `derived/comic/intel.json` | 漫画自动识别结果缓存 | 可重建 |
| `temp/` | 通用临时目录 | 可清理 |

- **落盘与维护原则**：始终先落盘用户状态（`state/`），再更新派生缓存（`derived/`）；`CacheMaintenance` 在启动及每小时仅限 5 类媒体派生目录内按 `cacheMaxAgeDays` 与 `cacheMaxSizeMB` 淘汰 10 分钟之前的完整缓存文件，绝不进入 `state/`。
- **状态备份（`StateBackupService`）**：支持导出与预览/分项恢复 `favorites`、`history`、`preferences`、`activities`、`covers`、`picks`、`people`、`smartAlbums`、`similarity`、`comicOverrides` 共 10 类状态，覆盖前自动在 `state/backups/` 留存备份。
- **优雅退出**：收到 `SIGINT`/`SIGTERM` 后停止接收新连接（HTTP 5 秒超时），取消活动扫描、转码与维护任务，强制刷新扫描缓存与尺寸缓存（后台 10 秒退出窗口）。

---

## 7. 前端架构与状态管理

### 分层结构

- `app/`：`routeManifest.tsx`（路由、标题、布局、导航与帮助上下文唯一清单）、`AppRoutes.tsx`（懒加载路由与旧书签重定向）、`AppProviders.tsx`。
- `ui/`：无业务耦合的基础组件原语（按钮、分段、页签、对话框、抽屉、菜单、焦点陷阱等）。
- `shell/`：应用外壳（`AppShell`、`Sidebar`、`CanvasTopBar`、`MobileTabBar`、`MoreSheet`、`CommandPalette`、`Page`、`AccessGate`、`WorkbenchModeProvider`）。
- `features/`：按业务领域组织（`album/`、`wall/`、`viewer/`、`reader/`、`timeline/`、`travels/`、`people/`、`search/`、`similarity/`、`settings/`、`tasks/`、`collection/`、`comic/`、`common/`）。
- `routes/`：路由页面装配层，解析 URL 参数并组合查询与视图。
- `api/` 与 `hooks/`：唯一网络层与 TanStack Query 封装；查询键集中注册在 [`frontend/src/api/queryKeys.ts`](../frontend/src/api/queryKeys.ts)。
- `store/`：Zustand 客户端状态（UI 偏好、阅读器设置、排序偏好、扫描/重建会话、临时多选），不复制长期媒体库、收藏或历史数据源。

### 关键前端机制

- **URL 驱动的工作台模式**：当前工作台完全由 URL 前缀（`/photo/*` vs `/comic/*`）推导，服务端 `Prefs.appMode` 仅用于 `/` 根路径落地。列表筛选（`q`、`sort`、`min`、`view`、`year`）、时间线与相册筛选均以 URL 为唯一真相源。
- **高性能虚拟化与大图连续浏览**：列表与时间线由 `react-virtuoso` 或视口窗口裁切渲染；照片墙按服务端原始像素宽高做纯函数自适应排布（`features/wall/`）；`PhotoViewer` 支持跨分页预加载与关闭后精确滚回并归还焦点。
- **漫画阅读进度同步队列**：`activityApi` 维护会话级串行写入队列，600ms 去抖并合并同卷未发送进度；恢复成功或确认 `activity_not_found` 前禁止写入，避免覆盖旧阅读位置；卸载时通过 `keepalive` 尽力补写。
- **服务端配置串行表单（`useServerConfigSave`）**：通过共享 mutation scope 串行提交配置，按「草稿 → 保存中 → 失败输入 → 确认值」优先级显示，并在中文 IME 组合期间暂停自动保存。

---

## 8. 测试策略与性能基准

- **后端**：按包就近编写单元测试；[`backend/tests/integration/`](../backend/tests/integration/) 启动真实 Fiber 路由验证扫描、资源 ID、缓存协商、路径安全与 SSE。
- **前端**：Vitest 覆盖组件、Hook、Store 与快捷键一致性（`shortcutsTable.test.ts`）；[`frontend/tests/e2e/`](../frontend/tests/e2e/) 由 `scripts/test-e2e.mjs` 启动隔离后端与临时媒体库按单 worker 顺序执行跨层验证。
- **性能基准与评测复现命令**：

```sh
# 后端 Go 性能基准（在 backend/ 执行）
go test ./internal/services -run '^$' -bench 'BenchmarkAIJobEstimate|BenchmarkAIJobStatePersist|BenchmarkSmartAlbumGroupsCacheHit|BenchmarkIncrementalScanDelta' -benchmem
go test ./internal/services -run '^$' -bench 'BenchmarkPeople' -benchmem
go test ./internal/services -run '^$' -bench '^BenchmarkVectorIndexSearch100K$' -benchtime=31x -benchmem
go test ./internal/services -run '^$' -bench 'BenchmarkThumbnailCold|BenchmarkVideoInfoRepeated' -benchmem
go test ./internal/store -run '^$' -bench 'BenchmarkActivity' -benchtime=20x -benchmem

# AI Worker 质量与设备评测（在仓库根目录执行，需配置本地模型与标注集）
python backend/aiworker/evaluate_quality.py --model-dir <cacheDir>/derived/ai/models --device gpu
python backend/aiworker/evaluate_people.py --annotations <标注清单.json> --models <cacheDir>/derived/ai/models --device cpu
```

> 仓库内置基准与合成夹具仅用于防性能回退和逻辑验证，不构成跨设备的绝对吞吐或人物识别准确率承诺；真实人物与相似照片阈值仍待基于本机标注集持续校准。
