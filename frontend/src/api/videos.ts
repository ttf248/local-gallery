import { API_BASE } from './client'

// 视频原始流 URL（供 <video src=...> 使用）。
//
// 后端 /api/videos 支持 Range，前端拖动进度条时浏览器自动按需分段。
export function videoUrl(absPath: string): string {
  const p = `/api/videos?path=${encodeURIComponent(absPath)}`
  return API_BASE ? `${API_BASE}${p}` : p
}

// 视频元信息（服务端可读字段；duration/width/height 由浏览器 <video>
// 元素加载后从 MediaError/currentTime 派生，不依赖 ffmpeg）。
export interface VideoInfo {
  path: string
  name: string
  dir: string
  size: number
  mtime: string
  format: string // 含点，如 ".mp4"
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
