import { api } from './client'

// 单本文件夹 / 集合 / 智能集合的统一响应。
export interface AlbumDetailResponse<T = unknown> {
  ok: boolean
  kind: 'album' | 'collection' | 'smart'
  data: T
}

export interface SearchHit {
  kind: 'album' | 'collection' | 'smartCollection'
  path: string
  name: string
  author?: string
  count: number
  coverImage?: string
}

export const albumsApi = {
  // 优先用 /api/folders（新）；失败时回退 /api/albums（兼容旧链接 / 客户端）。
  detail(path: string) {
    return api<AlbumDetailResponse>(`/api/folders`, {
      params: { path },
    })
  },
  search(q: string, limit = 50) {
    return api<{ ok: boolean; results: SearchHit[]; count: number }>(`/api/search`, {
      params: { q, limit },
    })
  },
  // 自定义封面：把 file 设为 album path 的封面（持久化到 cover_overrides.json）。
  // 设置后立即拉 /api/scan/latest 就能看到新封面。
  setCover(albumPath: string, file: string) {
    return api<{ ok: boolean; albumPath: string; coverImage: string; coverKind: string }>(
      `/api/albums/cover`,
      { method: 'PUT', params: { path: albumPath, file } }
    )
  },
  // 清除自定义封面：回退到扫描器默认（images[0]，否则 videos[0]）。
  clearCover(albumPath: string) {
    return api<{ ok: boolean; albumPath: string }>(`/api/albums/cover`, {
      method: 'DELETE',
      params: { path: albumPath },
    })
  },
}

// progressApi 已在 api/prefs.ts 中定义（带 .get / .set / .batch）。
// 旧代码请从 'api/prefs' 引入。
