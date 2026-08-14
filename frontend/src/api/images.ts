import { API_BASE } from './client'

// 全图 URL（与 thumbUrl 对应）
export function imageUrl(absPath: string): string {
  const p = `/api/images?path=${encodeURIComponent(absPath)}`
  return API_BASE ? `${API_BASE}${p}` : p
}
