import { api } from './client'

export interface AlbumSummary {
  type: 'album'
  path: string
  name: string
  coverImage: string
  imageCount: number
  author?: string
  modTime?: string
  folderSize?: number
}

export interface CollectionSummary {
  type: 'collection'
  path: string
  name: string
  albums: AlbumSummary[]
  albumCount: number
}

export interface SmartCollectionSummary {
  type: 'smartCollection'
  author: string
  albums: AlbumSummary[]
  albumCount: number
  coverImage: string
}

export interface ScanResult {
  root: string
  albums: AlbumSummary[]
  collections: CollectionSummary[]
  smartCollections: SmartCollectionSummary[]
  albumCount: number
  collectionCount: number
  duration: number
  scannedAt: string
}

export interface ScanStartResponse {
  scanId: string
}

export interface ProgressEvent {
  scanId: string
  progress: number
  status: 'pending' | 'running' | 'complete' | 'cancelled' | 'error'
  phase?: string
  currentPath?: string
  albumsFound: number
  error?: string
  elapsedMs: number
}

export const scanApi = {
  start: () => api<ScanStartResponse>('/api/scan/start', { method: 'POST' }),
  result: (id: string) => api<{ ok: boolean; result: ScanResult }>(`/api/scan/${id}/result`),
  cancel: (id: string) => api<{ ok: boolean }>(`/api/scan/${id}`, { method: 'DELETE' }),
}
