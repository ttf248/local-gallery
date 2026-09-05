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
