import { API_BASE } from './client'

// 缩略图 URL：通过 ?path=<绝对路径> 直接请求后端。
// 注意：实际部署需要后端路径校验（已在 T14 实施）。
export function thumbUrl(absPath: string): string {
  const path = `/api/thumbs?path=${encodeURIComponent(absPath)}`
  return API_BASE ? `${API_BASE}${path}` : path
}

// 把视频封面上传到后端。后端会把字节 resize → 缓存到磁盘。
//
// 失败场景由后端返回 4xx/5xx；本函数抛 Error 给调用方处理。
export async function uploadVideoCover(absPath: string, blob: Blob): Promise<void> {
  const url = API_BASE
    ? `${API_BASE}/api/thumbs/cover?path=${encodeURIComponent(absPath)}`
    : `/api/thumbs/cover?path=${encodeURIComponent(absPath)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'image/jpeg' },
    body: blob,
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j && typeof j.error === 'string') msg = j.error
    } catch {
      // ignore parse error
    }
    throw new Error(`upload cover failed: ${msg}`)
  }
}

export interface ThumbnailStats {
  memoryItems: number
  diskFiles: number
  cacheDir: string
}
