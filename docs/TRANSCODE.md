# 服务端转码方案

> 状态：方案稿 / 未实现
> 目标：让浏览器播不了冷门编码（AV1、HEVC、ProRes、VP9 在某些 Chromium 构建里也不全）时，自动在服务端转成 H.264 + AAC，浏览器无感知

---

## 1. 背景与现状

`docs/ARCHITECTURE.md` 描述了「扫描 → 缩略图 → 视频封面 → 视频流」的主链路。视频流这一步目前只做两件事：

```
/api/videos?path=...  →  VideoHandler  →  c.SendFile(path, false)
                                     └─ FaststartService.Resolve (重封装, 不重编码)
```

Faststart 解决了 **「moov 在文件末尾，浏览器边下边播卡死」** 这一类问题（典型由录屏/手机录制产生），但对另一类问题无能为力：

| 文件特征 | 浏览器行为 | Faststart 能否修 |
|---------|-----------|-----------------|
| moov 在末尾，H.264 编码 | 0:00 / 加载失败 | ✅ 重封装即可 |
| moov 在前，H.264 编码 | 正常播放 | — (跳过) |
| moov 在末尾，AV1 编码 | 0:00 / 加载失败 | ❌ 容器对了编码不支持 |
| moov 在前，AV1 编码 | 加载失败 | ❌ 同上 |
| moov 在末尾，HEVC 编码 | 加载失败 | ❌ 同上 |
| MOV / MKV，ProRes | 加载失败 | ❌ 容器或编码不支持 |

ffprobe 看过的实例：用户那个 4K AV1 MP4，浏览器拿不到帧。本机 Playwright 内置 Chromium 也不支持 AV1 软解（即使支持也要硬解权限），问题在编码兼容性而非容器。

**根本对策**：服务端转码，把视频流重新编码成 H.264 + AAC 喂给浏览器。

---

## 2. 设计目标

- **透明**：前端不需要知道某个文件是否需要转码；它永远向 `/api/videos?path=...` 发请求，永远拿到能播的字节
- **不阻断**：ffmpeg 不可用 / 转码失败 / 源文件损坏 → 静默回退到发原文件，浏览器会显示错误（至少跟今天一样）
- **可缓存**：转一次后下次直接命中；源文件改了就重转
- **可观测**：用户能看到「正在转码中，3 分 20 秒」而不是「加载失败」或「转圈」
- **可取消**：用户切走 / 关页面时，取消正在跑的 ffmpeg
- **可配置**：管理员能调码率 / 分辨率 / 并发数 / 缓存清理策略

---

## 3. 架构：在 FaststartService 旁边加 TranscodeService

不合并到一个 service（职责不同：faststart 是 remux `-c copy`，几秒搞定；transcode 是重编码，分钟级），但接入点共用。

### 3.1 解析顺序（VideoHandler 内）

```
请求 GET /api/videos?path=...
   │
   ▼
1. TranscodeService.Resolve(path)
   │  cache 命中     → 返回缓存文件 (StatusCached)
   │  cache 未命中    → 看 ffmpeg 是否可用
   │     不可用       → 回退到原文件 (StatusUnavailable)
   │     可用         → 探测 codec
   │        浏览器支持  → 跳过 transcode，记 "原文件可直发"
   │        不支持     → 启动后台转码 (StatusTranscoding)
   │                     → 立即返回正在转码的进度文件（partial）
   │                     或返回原文件并标记 in-flight（视策略）
   │
   ▼
2. FaststartService.Resolve(path)   (现在这一步的角色)
   │  原文件是 faststart → 直接发原文件
   │  不是 faststart     → remux 后发
   │
   ▼
3. 退到原文件 (StatusFallback)
   │
   ▼
c.SendFile(resolved, false) + 头照旧
```

**关键决策**：TranscodeService 在 FaststartService 之前决策。如果 transcode 走通了，整个链路就到此为止；否则退到 faststart 兜底（处理「moov 在末尾但编码是 H.264」这一类）。

### 3.2 codec 兼容性判定

服务端没法"问"浏览器支不支持某个 codec（没有 CORS 安全的 API），但可以查"已知支持列表"。两个数据源：

1. **ffprobe 输出**：`stream.codec_name`（如 `h264`、`hevc`、`av1`、`vp9`、`prores`）
2. **MIME 容器**：`format.format_name`（如 `mov,mp4,m4a,3gp,6gp`）

判定表（V1）：

| 视频 codec | 容器 | 浏览器可播？ | 处理 |
|-----------|------|-------------|------|
| h264 | mp4 / m4v / mov | ✅ | 跳过 transcode |
| h264 | mkv | ✅（Chrome/Edge）| 跳过 |
| h264 | avi | ⚠️（取决于 codec profile）| transcode（保守）|
| vp9 | webm | ✅ | 跳过 |
| vp8 | webm | ✅ | 跳过 |
| av1 | mp4 / m4v | ⚠️（取决于浏览器/硬解）| transcode |
| av1 | webm | ✅（Chrome/Edge）| 跳过 |
| hevc / h265 | mp4 / m4v / mov | ❌ | transcode |
| prores | mov | ❌ | transcode |
| 其他 / 未知 | 任何 | ❌ | transcode |

V1 只在「明确不支持」时才转码；「部分支持」（vp9 在 Safari、hevc 在 Safari）暂时一律放过，留 V2 引入更细的 UA 探测。

### 3.3 目标输出

固定一种输出，避免无限参数组合撑爆缓存：

```
容器:    mp4
视频:    H.264 High@L4.1（1080p 兼容）
音频:    AAC LC, 128kbps
moov:    faststart（at 开头）
```

参数 `transcodeProfile` 是个 struct，未来要加 "低码率 / 4K" 时新增 profile 即可，缓存 key 也包含 profile hash。

### 3.4 编码参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 视频 codec | libx264 | 唯一浏览器通用 |
| 编码 preset | medium | 速度/质量平衡 |
| profile | high | 主流设备全支持 |
| level | 4.1 | 1080p60 足够 |
| pixel format | yuv420p | 最广兼容 |
| CRF | 22 | 视觉无损/中等大小（可配）|
| 音频 codec | aac | 通用 |
| 音频码率 | 128k | 语音够用 |
| 分辨率 | 保持原样 | 不强行下采样（V1 简化）|
| 帧率 | 保持原样 | 同上 |
| 容器 | mp4 | faststart（让 -movflags +faststart 跟上 faststart 走）|

可调项：管理员可在 config.yaml 里覆盖 `crf` / `preset` / `videoBitrate` / `maxHeight`。

---

## 4. 缓存设计

### 4.1 目录结构

```
<cacheDir>/
├── video-faststart/
│   └── <md5(path|mtime|size)>.mp4      # remux 结果
└── video-transcode/
    └── <md5(path|mtime|size|profile)>.mp4   # 转码结果
```

### 4.2 key 派生

复用 `services.CacheKeyFromStat` 的同款 hash：

```go
func transcodeKey(absPath string, fi os.FileInfo, profile string) string {
    h := md5.New()
    fmt.Fprintf(h, "tx:%s|%d|%d|%s", absPath, fi.ModTime().UnixNano(), fi.Size(), profile)
    return hex.EncodeToString(h.Sum(nil))
}
```

源文件 mtime/size 变了 → 自动失效（用户重下载/重编码/剪辑后）。
profile 变了（比如从 1080p 升到 4K profile）→ 自动失效。

### 4.3 缓存清理

V1 不做自动 LRU 清理（默认 .image-viewer 本来也是累积式，跟 thumbs 一样）。管理员通过：

- 配置项 `transcodeCacheMaxBytes`（V2）：超过就 LRU 清
- 现有 `/api/thumbs/clear` 加一个开关 / 新增 `/api/transcode/clear`

### 4.4 大小估计

| 源文件 | 输出估算（CRF 22 H.264）|
|--------|------------------------|
| 1 GB 4K HEVC (高压缩) | ~1-2 GB |
| 1 GB 1080p H.264 (高码率) | ~300-500 MB |
| 500 MB 1080p AV1 | ~400-600 MB |

500 GB 媒体库假设 20% 是冷门编码 → 转码后额外 50-100 GB 缓存空间。管理员心里有数即可。

---

## 5. 并发与取消

### 5.1 单视频并发：复用 singleflight

```go
type TranscodeService struct {
    flight singleflight.Group   // 同一 key 同一时刻只跑一个 ffmpeg
    ...
}
```

跟 FaststartService 一个套路：10 个用户同时打开同一个 4K AV1 视频，只转一次。

### 5.2 全局并发上限

ffmpeg `-c:v libx264 -preset medium` 吃满 1 个核心。开 8 个并发 = 8 核机器满载。

```go
type TranscodeService struct {
    sem chan struct{}   // 容量 = TranscodeConcurrency
    ...
}

func (s *TranscodeService) Start(...) error {
    select {
    case s.sem <- struct{}{}:
        go func() {
            defer func() { <-s.sem }()
            ... 转码 ...
        }()
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

默认 `TranscodeConcurrency = max(1, runtime.NumCPU() / 2)`，可被 config 覆盖。

### 5.3 取消

每个转码任务持有一个 `context.CancelCauseFunc`，存在 service 的 `inflight map[string]context.CancelFunc` 里：

- 用户停等 SSE → service 收到断开事件 → 取消对应 context → ffmpeg 进程 SIGTERM
- 用户在等转码时切到别的视频 → 前端主动调 `POST /api/videos/transcode/cancel?path=...` → cancel
- service 进程退出时 → range map 全部 cancel

### 5.4 超时

| 超时 | 默认 | 说明 |
|------|------|------|
| 单视频转码 | 30 分钟 | 4K 60min 通常 10-20 分钟，30 分钟保底 |
| 探测 codec | 5 秒 | 跟现有 `VideoInfoService` 一致 |
| 写盘 | - | 跟随 ctx 一起取消 |

---

## 6. API 设计

### 6.1 现有端点（无破坏性变更）

```
GET /api/videos?path=...      # 视频流（不变）
GET /api/videos/info?path=... # 视频元信息（新增 transcodeStatus 字段）
```

### 6.2 新增端点

```
GET  /api/videos/transcode/status?path=...
   → { status, progress, etaSec, error }
   status: "not_needed" | "cached" | "queued" | "running" | "failed"
   progress: 0.0 ~ 1.0
   etaSec: 剩余秒数（V1 用 ffmpeg 的 out_time_ms 推算，可能不准确）

GET  /api/videos/transcode/events?path=...
   → SSE 推 progress / done / error / cancelled 事件
   参考现有 /api/scan/:id/events

POST /api/videos/transcode/cancel?path=...
   → 取消正在跑的转码
   已经在写盘的也能取消（保留 partial 但不暴露给前端）
```

### 6.3 info 端点扩展

```json
{
  "path": "E:\\存照\\...",
  "name": "xxx.mp4",
  "dir": "...",
  "size": 552961026,
  "mtime": "...",
  "format": ".mp4",
  "duration": 1631.02,
  "width": 3840,
  "height": 2160,
  "codec": "av1",          // 现有
  "container": "mov,mp4",  // 现有
  "bitRate": 2712082,      // 现有
  "probeError": "",        // 现有
  "transcode": {           // 新增
    "needed": true,        // 后端判断"浏览器播不了"
    "status": "cached",    // not_needed | cached | queued | running | failed
    "progress": 1.0,       // 0~1
    "error": ""            // 失败原因
  }
}
```

前端可以在视频列表的卡片上显示"🔄 转码中 30%"或"✅ 已缓存"。

### 6.4 /api/videos 行为变化

不变（透明）。但内部：

- 如果有缓存 → 立即发缓存文件
- 如果正在转码 → 默认发原文件（用户能看到的还是"加载中"），前端通过 SSE 看到转码进度
- 如果转码失败 → 静默发原文件
- 如果用户已经在等 → 可以用 503 + Retry-After 让前端轮询（V2 再说，V1 就发原文件）

---

## 7. 前端改动

### 7.1 视频列表卡片

在 `AlbumCard` / `VideoCoverImage` 等组件里：

- 转码状态 > 0% < 100%：卡片上加进度条 + "转码中 30%"
- 转码失败：卡片上小红点 "⚠️ 转码失败"
- 缓存命中：什么都不显示（已优化）

### 7.2 播放页（VideoPlayer.tsx）

打开视频时：

1. 调 `/api/videos/info?path=...` 看 `transcode.needed` 和 `transcode.status`
2. 如果 `cached`：直接播，0 等待
3. 如果 `not_needed`：直接播（H.264 等）
4. 如果 `running`：
   - 订阅 `/api/videos/transcode/events?path=...`
   - 在 `<video>` 元素上盖一层「视频正在转码中 30% 预计还要 3 分钟」
   - **同时**也向 `/api/videos?path=...` 发请求 —— 服务端会发原文件，浏览器自己决定怎么处理（大概率是 onError，告知用户）
   - 收到 SSE 的 `done` 事件后，重挂载 `<video src=...>` 走缓存
5. 如果 `queued`：显示 "等待转码中..."（前面有别的在转）
6. 如果 `failed`：显示转码错误 + 提示用户去后端查日志

### 7.3 进度条组件

`src/components/viewer/TranscodeProgress.tsx`（新文件）：

```tsx
interface Props {
  status: 'queued' | 'running' | 'done' | 'failed'
  progress: number  // 0-1
  etaSec?: number
  error?: string
}
```

UI 跟现有 toast / progress 风格保持一致：暗色背景、圆角、padding 4 之类的现有 token。

### 7.4 重试行为

V1：用户关掉 viewer 后再开，会重新查 transcode.status。已 cached 的立即播；还在 running 的接着 SSE 订阅；queued 的等。

---

## 8. 配置

`backend/config.yaml` 新增：

```yaml
# 转码总开关
transcodeEnabled: true

# ffmpeg 编码参数
transcode:
  preset: medium          # ultrafast | superfast | veryfast | faster | fast | medium | slow | veryslow
  crf: 22                 # 18 高质量, 28 低码率
  videoBitrate: ""        # 留空用 CRF; 设了则走 -b:v (CBR/VBR)
  maxHeight: 0            # 0 = 不限; 1080 = 大于 1080 缩到 1080
  audioBitrate: "128k"
  audioCodec: "aac"

# 并发与超时
transcodeConcurrency: 0   # 0 = auto (NumCPU/2)
transcodeTimeout: 30m
```

不破坏现有 ffmpeg/ffprobe 字段（`ffmpegPath` 复用）。

---

## 9. 失败模式与回退

| 场景 | 行为 | 后果 |
|------|------|------|
| ffmpeg 不可用 | `Resolve()` 返回原文件 + StatusUnavailable | 浏览器按今天的行为失败（但不恶化）|
| ffmpeg 启动后立刻挂 | stderr 解析 → 记 `transcode.failed` 到 info，下次直接发原文件 | 用户看到原 file 失败提示 |
| ffmpeg 转一半挂（编码不支持） | 同上 | 同上 |
| 磁盘满 | `os.WriteFile` 失败 → 取消，标记 failed | 同上 |
| 源文件被删 | Stat 失败 → 跟现在一样返回 404 | 同上 |
| 缓存文件写入 0 字节 | 启动时校验 size > 0，删除重转 | 用户多等一会儿 |
| 多个用户同时请求同一冷门视频 | singleflight 合一；其余订阅 SSE | 体验顺滑 |
| 转一半用户走了 | ffmpeg 进程被 cancel；下次开重新转 | 浪费一点 CPU（用户主动走不算 bug）|
| 源文件 mtime 变化 | key 失效，重新转 | 自动 |
| 源文件大小写/路径微调 | 重新生成 key | 重新转（不会撞缓存）|

**所有失败都记 stderr 一行**：`transcode failed for <path>: <err>`，管理员能从 server log 排查。

---

## 10. 测试策略

### 10.1 单元测试（`video_transcode_test.go`）

- `Resolve()` 在各种 codec / 容器组合下的判定正确
- 缓存命中 / 失效行为（mtime 变 → 失效）
- singleflight 10 协程并发只跑一次 ffmpeg
- 取消：context 取消时 ffmpeg 进程被 SIGTERM
- ffmpeg 不可用时降级
- codec 探测超时降级

### 10.2 集成测试

- `/api/videos/info` 返回新 `transcode` 字段
- 端到端：传一个非 faststart + AV1 视频给 harness，触发 transcode，轮询 status，等 cached，再 GET `/api/videos` 验证返回的是转码后的字节

### 10.3 端到端 / 性能

- 1GB AV1 → 4K H.264：测实际转码耗时（在 v2 文档里补 benchmark）
- 8 并发压测
- 取消 < 1s 内生效

---

## 11. 实施阶段

**Phase 1 - 最小可用**（约 1 周）

1. `VideoTranscodeService` 骨架 + `Resolve()` + 缓存
2. 接入 `VideoHandler`（透明：发原文件 / 发缓存）
3. config 加 3-4 个核心开关
4. 单元测试 + 集成测试
5. `/api/videos/transcode/status` REST 端点
6. **不发 SSE**（V1 简单点，前端轮询）

**Phase 2 - 用户感知**

1. SSE 进度事件
2. 前端 `TranscodeProgress` 组件
3. 列表卡片显示转码状态
4. 取消 API

**Phase 3 - 进阶**

1. 缓存 LRU 清理
2. 多 profile（4K / 1080p / 720p）
3. 硬解（`-c:v h264_nvenc` / `h264_qsv` / `h264_videotoolbox`）
4. 智能预转码：扫描时识别"非 H.264 视频"，空闲时后台预转

---

## 12. 风险与权衡

| 风险 | 缓解 |
|------|------|
| 1GB 视频转 5-15 分钟，首次播放体验差 | SSE 进度 + 提前在扫描时预转热门视频（V3）|
| 缓存膨胀 | V1 接受；V2 加 LRU + 配置 max bytes |
| ffmpeg 把高码率 H.264 转成更大文件 | 让用户能调 CRF；不强制重转 H.264 文件 |
| 多个 ffmpeg 把机器吃满 | 全局 sem 控制并发数 |
| 取消不及时 ffmpeg 还在跑 | 显式 SIGTERM + 5s grace 强杀 |
| 转码失败时用户看不到原因 | stderr 进 log；UI 显示简短错误（详细原因在 server log）|
| `transcode` 字段是 opt-in，UI 显示要小心 | 列表卡片只显示小图标，不抢戏 |
| 路径 / mtime 哈希碰撞 | MD5 + 全字段拼接，碰撞概率 < 1e-20 |

---

## 13. 现状 vs 目标

| 行为 | 现状 | 目标 |
|------|------|------|
| moov 在末尾 + H.264 | ✅ (faststart) | ✅ |
| moov 在末尾 + AV1 | ❌ 加载失败 | ✅ 后端转 H.264，浏览器无感 |
| H.264 已经在头 | ✅ | ✅ |
| HEVC | ❌ | ✅ |
| ProRes | ❌ | ✅ |
| MKV / WebM 冷编码 | ❌ | ✅（按需转）|
| 用户看到进度 | ❌ (空白) | ✅ SSE + 进度条 |
| 用户取消 | N/A | ✅ |

完成后用户能播几乎所有常见视频，不需要懂 faststart 也不需要懂 codec。

---

## 14. 不在 V1 范围

- HDR / Dolby Vision 保留（`-c:v libx264` 丢 HDR）
- 字幕烧录（pass-through 字幕另开 PR）
- 音轨多语言切换
- HLS / DASH 自适应码率
- 客户端手动选 profile

这些都先记在这里，等 V1 落地后按用户反馈决定优先级。
