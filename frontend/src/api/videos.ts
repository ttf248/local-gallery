import { API_BASE } from './client'

// 视频原始流 URL（供 <video src=...> 使用）。
//
// 后端 /api/videos 支持 Range，前端拖动进度条时浏览器自动按需分段。
export function videoUrl(absPath: string): string {
  const p = `/api/videos?path=${encodeURIComponent(absPath)}`
  return API_BASE ? `${API_BASE}${p}` : p
}

// 视频元信息。
//
// 必填字段：path/name/dir/size/mtime/format。
// 可选字段（服务端 ffprobe 可用时填,否则缺省）：
//   - duration / width / height / codec / container / bitRate
//   - probeError:解析失败时,后端会把错误消息塞这里（不抛 5xx）
//   - transcode:服务端转码状态(Phase 2 新增);后端 ffmpeg 不可用时整个字段省略
//
// 旧版(v1)由前端 <video> 元素 loadedmetadata 派生,延迟到点击播放
// 之后;v2 服务端 ffprobe 一次性返回,UI 在列表就能展示时长。
export interface VideoInfo {
  path: string
  name: string
  dir: string
  size: number
  mtime: string
  format: string // 含点，如 ".mp4"
  // ffprobe 元数据(可选)
  duration?: number
  width?: number
  height?: number
  codec?: string
  container?: string
  bitRate?: number
  probeError?: string
  // 服务端转码状态(可选,Phase 2 新增)
  transcode?: TranscodeStatus
}

export async function getVideoInfo(absPath: string): Promise<VideoInfo> {
  const url = API_BASE
    ? `${API_BASE}/api/videos/info?path=${encodeURIComponent(absPath)}`
    : `/api/videos/info?path=${encodeURIComponent(absPath)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`video info failed: HTTP ${res.status}`)
  }
  return (await res.json()) as VideoInfo
}

// ---- 服务端转码 (Phase 2) ----

export type TranscodeStatusValue =
  | 'skipped'
  | 'unavailable'
  | 'not_needed'
  | 'cached'
  | 'queued'
  | 'running'
  | 'failed'
  | 'unknown'

export interface TranscodeStatus {
  status: TranscodeStatusValue
  progress: number // 0-1
  etaSec: number
  error?: string
}

/**
 * 查转码状态（一次性；轮询用）。
 *
 * @param absPath 视频绝对路径
 */
export async function getTranscodeStatus(absPath: string): Promise<TranscodeStatus> {
  const url = API_BASE
    ? `${API_BASE}/api/videos/transcode/status?path=${encodeURIComponent(absPath)}`
    : `/api/videos/transcode/status?path=${encodeURIComponent(absPath)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`transcode status failed: HTTP ${res.status}`)
  }
  return (await res.json()) as TranscodeStatus
}

/**
 * 取消转码。
 */
export async function cancelTranscode(absPath: string): Promise<void> {
  const url = API_BASE
    ? `${API_BASE}/api/videos/transcode/cancel?path=${encodeURIComponent(absPath)}`
    : `/api/videos/transcode/cancel?path=${encodeURIComponent(absPath)}`
  await fetch(url, { method: 'POST' })
}

/**
 * 订阅转码进度事件（SSE）。
 *
 * 返回:
 *   - close(): 关闭连接 + 清理
 *
 * 用法:
 *   const close = subscribeTranscodeEvents(path, {
 *     onProgress: (s) => setState(s),
 *     onDone: (s) => { close(); ... }
 *   })
 */
export function subscribeTranscodeEvents(
  absPath: string,
  handlers: {
    onProgress?: (status: TranscodeStatus) => void
    onDone?: (status: TranscodeStatus) => void
    onError?: (err: Event) => void
  },
): () => void {
  const url = API_BASE
    ? `${API_BASE}/api/videos/transcode/events?path=${encodeURIComponent(absPath)}`
    : `/api/videos/transcode/events?path=${encodeURIComponent(absPath)}`
  const es = new EventSource(url)

  es.addEventListener('progress', (e) => {
    try {
      const status = JSON.parse((e as MessageEvent).data) as TranscodeStatus
      handlers.onProgress?.(status)
    } catch {
      // ignore parse error
    }
  })
  es.addEventListener('done', (e) => {
    try {
      const status = JSON.parse((e as MessageEvent).data) as TranscodeStatus
      handlers.onDone?.(status)
    } catch {
      // ignore
    }
    es.close()
  })
  es.onerror = (e) => {
    handlers.onError?.(e)
    // EventSource 在网络断开时会自动重连;不主动 close,
    // 让浏览器自己处理(组件 unmount 时由返回的 close() 关)
  }

  return () => es.close()
}
