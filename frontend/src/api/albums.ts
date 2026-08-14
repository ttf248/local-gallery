import { api } from './client'

// 单本相册 / 集合 / 智能集合的统一响应。
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
  detail(path: string) {
    return api<AlbumDetailResponse>(`/api/albums`, {
      params: { path },
    })
  },
  search(q: string, limit = 50) {
    return api<{ ok: boolean; results: SearchHit[]; count: number }>(`/api/search`, {
      params: { q, limit },
    })
  },
}

export const progressApi = {
  set(path: string, index: number, total: number, scroll = 0) {
    return api<{ ok: boolean }>(`/api/progress`, {
      method: 'POST',
      body: { path, index, total, scroll },
    })
  },
  get(path: string) {
    return api<{ path: string; index: number; total: number; scroll: number; updated: string }>(
      `/api/progress`,
      { params: { path } },
    )
  },
}
