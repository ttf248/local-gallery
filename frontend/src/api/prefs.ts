import { api } from './client'

export interface Prefs {
  favorites: string[]
  history: { path: string; name: string; imageCount: number; openedAt: string }[]
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
  add: (path: string) =>
    api<{ favorites: string[] }>('/api/favorites', { method: 'POST', body: { path } }),
  remove: (path: string) =>
    api<{ favorites: string[] }>('/api/favorites', { method: 'DELETE', body: { path } }),
  prune: () =>
    api<{ removed: string[] }>('/api/favorites/prune', { method: 'POST' }),
}

export const historyApi = {
  list: () => api<{ history: Prefs['history'] }>('/api/history'),
  add: (entry: { path: string; name: string; imageCount: number }) =>
    api<{ history: Prefs['history'] }>('/api/history', { method: 'POST', body: entry }),
  clear: () => api<{ ok: boolean }>('/api/history', { method: 'DELETE' }),
}

export interface ReadingProgress {
  path: string
  index: number
  total: number
  scroll: number
  updated: string
}

export const progressApi = {
  get: (path: string) =>
    api<ReadingProgress>('/api/progress', { params: { path } }),
  set: (path: string, index: number, total: number, scroll = 0) =>
    api<{ ok: boolean }>('/api/progress', {
      method: 'POST',
      body: { path, index, total, scroll },
    }),
  // 批量获取：避免 N 路并发 GET /api/progress
  batch: (paths: string[]) =>
    api<{ progress: Record<string, ReadingProgress>; count: number }>(
      '/api/progress/batch',
      { method: 'POST', body: { paths } },
    ),
}
