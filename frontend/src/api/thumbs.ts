import { API_BASE } from './client'

// 缩略图 URL：通过 ?path=<绝对路径> 直接请求后端。
// 注意：实际部署需要后端路径校验（已在 T14 实施）。
export function thumbUrl(absPath: string): string {
  const path = `/api/thumbs?path=${encodeURIComponent(absPath)}`
  return API_BASE ? `${API_BASE}${path}` : path
}

export interface ThumbnailStats {
  memoryItems: number
  diskFiles: number
  cacheDir: string
}
