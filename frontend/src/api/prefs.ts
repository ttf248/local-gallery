import { api } from './client'

export interface Prefs {
  favorites: string[]
  history: {
    albumId: string
    name: string
    imageCount: number
    openedAt: string
  }[]
  maxRecent: number
  autoSwitchAlbum: boolean
  showSwitchNotif: boolean
  theme: 'light' | 'dark' | 'system'
  sidebarCollapsed: boolean
}

export const prefsApi = {
  get: () => api<Prefs>('/api/prefs'),
  patch: (patch: Partial<Prefs>) =>
    api<Prefs>('/api/prefs', { method: 'PATCH', body: patch }),
}

export const favoritesApi = {
  list: () => api<{ favorites: string[] }>('/api/favorites'),
  add: (resourceId: string) =>
    api<{ favorites: string[] }>('/api/favorites', {
      method: 'POST',
      body: { resourceId },
    }),
  remove: (resourceId: string) =>
    api<{ favorites: string[] }>('/api/favorites', {
      method: 'DELETE',
      body: { resourceId },
    }),
  prune: () =>
    api<{ removed: string[] }>('/api/favorites/prune', { method: 'POST' }),
}

export const historyApi = {
  list: () => api<{ history: Prefs['history'] }>('/api/history'),
  add: (entry: { albumId: string; name: string; imageCount: number }) =>
    api<{ history: Prefs['history'] }>('/api/history', {
      method: 'POST',
      body: entry,
    }),
  clear: () => api<{ ok: boolean }>('/api/history', { method: 'DELETE' }),
}

export interface ReadingProgress {
  albumId: string
  index: number
  total: number
  scroll: number
  updated: string
}

export const progressApi = {
  get: (albumId: string) =>
    api<ReadingProgress>('/api/progress', { params: { albumId } }),
  set: (albumId: string, index: number, total: number, scroll = 0) =>
    api<{ ok: boolean }>('/api/progress', {
      method: 'POST',
      body: { albumId, index, total, scroll },
    }),
  // 批量获取：避免 N 路并发 GET /api/progress
  batch: (albumIds: string[]) =>
    api<{ progress: Record<string, ReadingProgress>; count: number }>(
      '/api/progress/batch',
      { method: 'POST', body: { albumIds } },
    ),
  setBatch: (
    entries: {
      albumId: string
      index: number
      total: number
      scroll?: number
    }[],
  ) =>
    api<{ ok: boolean; updated: number }>('/api/progress/batch', {
      method: 'PUT',
      body: { entries },
    }),
  // 「继续阅读」管理：
  // - delete(albumId) 移除单条（首页"继续阅读"上的 X 按钮）
  // - clearAll()   清空所有（首页"继续阅读"头部的"清空"链接）
  // 都不影响 favorites / history / prefs。
  delete: (albumId: string) =>
    api<{ ok: boolean; removed: boolean }>('/api/progress/item', {
      params: { albumId },
      method: 'DELETE',
    }),
  clearAll: () =>
    api<{ ok: boolean; removed: number }>('/api/progress', {
      method: 'DELETE',
    }),
}
