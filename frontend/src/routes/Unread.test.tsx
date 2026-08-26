import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Unread from './Unread'
import { useLibraryStore } from '../store/libraryStore'
import { useFavorites } from '../hooks/useFavorites'
import { useSearchStore } from '../store/searchStore'

// 全部依赖外部 hook,组件本身不直接 fetch — mock 掉避免网络。
vi.mock('../hooks/useFavorites', () => ({
  useFavorites: vi.fn(),
}))
vi.mock('../hooks/useReadingProgress', () => ({
  useAllProgress: vi.fn(),
}))
vi.mock('../hooks/useGalleryContextSync', () => ({
  useGalleryContextSync: vi.fn(),
}))
vi.mock('../components/common/ListFilterBar', () => ({
  ListFilterBar: () => <div data-testid="filter-bar" />,
}))

import { useAllProgress } from '../hooks/useReadingProgress'

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

function renderUnread() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Unread />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Unread', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLibraryStore.setState({ result: null })
    useSearchStore.getState().reset()
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    })
  })

  it('有未读时显示计数 + 随机按钮', async () => {
    seedLibrary([baseAlbum('/a', 'A'), baseAlbum('/b', 'B')])
    vi.mocked(useAllProgress).mockReturnValue({
      data: {},
      isLoading: false,
    } as never)
    renderUnread()
    await waitFor(() => {
      // 页头 counter:还有 X 本没看。直接用 queryAllByText 扫整个 DOM,
      // 看有没有 <p> 包含 "还有" — 这样比函数 matcher 更稳,避免祖先元素
      // 也「碰巧」包含这段文本导致多个匹配。
      const headerHasCount = screen.queryAllByText(/还有/).length > 0
      expect(headerHasCount).toBe(true)
    })
    expect(screen.getByText('随机一本未读')).toBeInTheDocument()
  })

  it('全部看完时显示「看完了」空态', async () => {
    seedLibrary([baseAlbum('/a', 'A')])
    vi.mocked(useAllProgress).mockReturnValue({
      data: {
        '/a': { albumId: '/a', index: 9, total: 10, scroll: 0, updated: '' },
      },
      isLoading: false,
    } as never)
    renderUnread()
    await waitFor(() => {
      expect(screen.getByText(/全部看完啦/)).toBeInTheDocument()
    })
  })

  it('全库为空时引导去设置', async () => {
    // 不 seedLibrary → result=null
    vi.mocked(useAllProgress).mockReturnValue({
      data: {},
      isLoading: false,
    } as never)
    renderUnread()
    await waitFor(() => {
      expect(screen.getByText(/尚未加载图像库/)).toBeInTheDocument()
    })
    expect(screen.getByText('去设置')).toBeInTheDocument()
  })

  it('最小图数变化后立即重新筛选', async () => {
    seedLibrary([baseAlbum('/a', 'A', 2), baseAlbum('/b', 'B', 10)])
    vi.mocked(useAllProgress).mockReturnValue({
      data: {},
      isLoading: false,
    } as never)
    renderUnread()

    expect(await screen.findByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()

    act(() => useSearchStore.getState().setMinImageCount(5))

    await waitFor(() => expect(screen.queryByText('A')).not.toBeInTheDocument())
    expect(screen.getByText('B')).toBeInTheDocument()
  })
})
