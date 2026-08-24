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
