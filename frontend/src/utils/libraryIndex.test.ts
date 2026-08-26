import { describe, expect, it } from 'vitest'
import type {
  AlbumSummary,
  CollectionSummary,
  ScanResult,
} from '../api/scan'
import { buildLibraryIndex } from './libraryIndex'

function album(path: string): AlbumSummary {
  return {
    type: 'album',
    path,
    name: path,
    coverImage: '',
    imageCount: 1,
  }
}

function collection(
  path: string,
  albums: AlbumSummary[],
  collections: CollectionSummary[] = [],
): CollectionSummary {
  return {
    type: 'collection',
    path,
    name: path,
    albums,
    collections,
    albumCount: albums.length,
  }
}

it('递归索引任意深度集合并去重标签聚合中的相册', () => {
  const deepAlbum = album('a_0000000000000000000002')
  const result: ScanResult = {
    root: 'r_0000000000000000000000',
    albums: [album('a_0000000000000000000001')],
    collections: [
      collection('c_0000000000000000000001', [], [
        collection('c_0000000000000000000002', [deepAlbum]),
      ]),
    ],
    smartCollections: [
      {
        type: 'smartCollection',
        author: '旅行',
        albums: [deepAlbum],
        albumCount: 1,
        coverImage: '',
      },
    ],
    albumCount: 2,
    collectionCount: 2,
    duration: 1,
    scannedAt: '2026-01-01T00:00:00Z',
  }

  const index = buildLibraryIndex(result)

  expect(index.albumIds).toEqual([
    'a_0000000000000000000001',
    'a_0000000000000000000002',
  ])
  expect(index.collectionsById.has('c_0000000000000000000002')).toBe(true)
})

describe('buildLibraryIndex', () => {
  it('空快照返回空索引', () => {
    const index = buildLibraryIndex(null)
    expect(index.albumIds).toEqual([])
    expect(index.albumsById.size).toBe(0)
    expect(index.collectionsById.size).toBe(0)
  })
})
