import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUnreadAlbums } from './useUnreadAlbums'
import { useLibraryStore } from '../store/libraryStore'
import { useFavorites } from './useFavorites'

// 这些 hook 同时被 useUnreadAlbums 使用,所以 mock 掉,避免触发网络。
vi.mock('./useFavorites', () => ({
  useFavorites: vi.fn(),
}))
vi.mock('./useReadingProgress', () => ({
  useAllProgress: vi.fn(),
}))

import { useAllProgress } from './useReadingProgress'

const baseAlbum = (path: string, name: string, imageCount = 10) => ({
  type: 'album' as const,
  path,
  name,
  imageCount,
  videoCount: 0,
  files: [],
  imageFiles: [],
  coverImage: path + '/cover.jpg',
  folderSize: 0,
  tags: [] as string[],
  modTime: '',
})

function seedLibrary(albums: ReturnType<typeof baseAlbum>[]) {
  useLibraryStore.setState({
    result: {
      root: '/',
      roots: ['/'],
      albums,
      collections: [],
      smartCollections: [],
      albumCount: albums.length,
      collectionCount: 0,
      duration: 0,
      scannedAt: new Date().toISOString(),
    },
  })
}

describe('useUnreadAlbums', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLibraryStore.setState({ result: null })
  })

  it('没有 progress 的相册视为未读', () => {
    seedLibrary([baseAlbum('/a', 'A'), baseAlbum('/b', 'B')])
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    })
    vi.mocked(useAllProgress).mockReturnValue({
      data: {},
      isLoading: false,
    } as never)

    const { result } = renderHook(() => useUnreadAlbums())
    expect(result.current.count).toBe(2)
    expect(result.current.cards.map((c) => c.title)).toEqual(['A', 'B'])
  })

  it('progress.index > 0 视为已开始,不算未读', () => {
    seedLibrary([baseAlbum('/a', 'A'), baseAlbum('/b', 'B')])
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    })
    vi.mocked(useAllProgress).mockReturnValue({
      data: {
        '/a': { albumId: '/a', index: 3, total: 10, scroll: 0, updated: '' },
      },
      isLoading: false,
    } as never)

    const { result } = renderHook(() => useUnreadAlbums())
    expect(result.current.count).toBe(1)
    expect(result.current.cards.map((c) => c.title)).toEqual(['B'])
  })

  it('progress.index === 0 视为未读(刚开始)', () => {
    seedLibrary([baseAlbum('/a', 'A')])
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    })
    vi.mocked(useAllProgress).mockReturnValue({
      data: {
        '/a': { albumId: '/a', index: 0, total: 10, scroll: 0, updated: '' },
      },
      isLoading: false,
    } as never)

    const { result } = renderHook(() => useUnreadAlbums())
    expect(result.current.count).toBe(1)
  })

  it('progress.total === 0 视为未读(老格式进度数据)', () => {
    seedLibrary([baseAlbum('/a', 'A')])
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    })
    vi.mocked(useAllProgress).mockReturnValue({
      data: {
        '/a': { albumId: '/a', index: 5, total: 0, scroll: 0, updated: '' },
      },
      isLoading: false,
    } as never)

    const { result } = renderHook(() => useUnreadAlbums())
    expect(result.current.count).toBe(1)
  })

  it('total 反映全库总数,不是未读数', () => {
    seedLibrary([
      baseAlbum('/a', 'A'),
      baseAlbum('/b', 'B'),
      baseAlbum('/c', 'C'),
    ])
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    })
    vi.mocked(useAllProgress).mockReturnValue({
      data: {
        '/a': { albumId: '/a', index: 3, total: 10, scroll: 0, updated: '' },
      },
      isLoading: false,
    } as never)

    const { result } = renderHook(() => useUnreadAlbums())
    expect(result.current.count).toBe(2) // 未读
    expect(result.current.total).toBe(3) // 全库
  })

  it('isFavorite 从 favorites Set 派生', () => {
    seedLibrary([baseAlbum('/a', 'A'), baseAlbum('/b', 'B')])
    vi.mocked(useFavorites).mockReturnValue({
      favorites: ['/b'],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    })
    vi.mocked(useAllProgress).mockReturnValue({
      data: {},
      isLoading: false,
    } as never)

    const { result } = renderHook(() => useUnreadAlbums())
    const byTitle = Object.fromEntries(
      result.current.cards.map((c) => [c.title, c.isFavorite]),
    )
    expect(byTitle['A']).toBeFalsy()
    expect(byTitle['B']).toBe(true)
  })
})
