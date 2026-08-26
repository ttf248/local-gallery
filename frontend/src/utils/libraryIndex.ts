import type {
  AlbumSummary,
  CollectionSummary,
  ScanResult,
} from '../api/scan'

export interface LibraryIndex {
  albumsById: Map<string, AlbumSummary>
  collectionsById: Map<string, CollectionSummary>
  albumIds: string[]
}

// 将顶层相册、任意深度集合和标签聚合统一成 ID 索引。标签聚合中的相册
// 可能与目录树重复，Map 会保留单份，避免批量进度请求和列表重复。
export function buildLibraryIndex(result: ScanResult | null): LibraryIndex {
  const albumsById = new Map<string, AlbumSummary>()
  const collectionsById = new Map<string, CollectionSummary>()

  const addAlbum = (album: AlbumSummary) => {
    if (album.path) albumsById.set(album.path, album)
  }
  const visitCollection = (collection: CollectionSummary) => {
    if (collection.path) collectionsById.set(collection.path, collection)
    collection.albums.forEach(addAlbum)
    collection.collections?.forEach(visitCollection)
  }

  result?.albums.forEach(addAlbum)
  result?.collections.forEach(visitCollection)
  result?.smartCollections.forEach((collection) => {
    collection.albums.forEach(addAlbum)
  })

  return {
    albumsById,
    collectionsById,
    albumIds: Array.from(albumsById.keys()),
  }
}
