import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { progressApi } from '../api/prefs'
import { useAllProgress, useMarkAllAsRead } from './useReadingProgress'

vi.mock('../api/prefs', () => ({
  progressApi: {
    get: vi.fn(),
    set: vi.fn(),
    batch: vi.fn(),
    setBatch: vi.fn(),
    delete: vi.fn(),
    clearAll: vi.fn(),
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  )
}

describe('useMarkAllAsRead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(progressApi.setBatch).mockResolvedValue({ ok: true, updated: 2 })
  })

  it('整批只发送一次请求', async () => {
    const { result } = renderHook(() => useMarkAllAsRead(), { wrapper })
    let response: { ok: number; failed: number; total: number } | undefined
    await act(async () => {
      response = await result.current.mutateAsync([
        { albumId: 'a_0000000000000000000001', total: 12 },
        { albumId: 'a_0000000000000000000002', total: 20 },
      ])
    })

    expect(progressApi.setBatch).toHaveBeenCalledTimes(1)
    expect(progressApi.setBatch).toHaveBeenCalledWith([
      {
        albumId: 'a_0000000000000000000001',
        index: 12,
        total: 12,
        scroll: 0,
      },
      {
        albumId: 'a_0000000000000000000002',
        index: 20,
        total: 20,
        scroll: 0,
      },
    ])
    expect(progressApi.set).not.toHaveBeenCalled()
    expect(response).toEqual({ ok: 2, failed: 0, total: 2 })
  })
})

describe('useAllProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(progressApi.batch).mockImplementation(async (albumIds) => ({
      count: albumIds.length,
      progress: Object.fromEntries(
        albumIds.map((albumId) => [
          albumId,
          { albumId, index: 1, total: 10, scroll: 0, updated: '' },
        ]),
      ),
    }))
  })

  it('去重并分块读取大批量进度', async () => {
    const albumIds = Array.from(
      { length: 1_001 },
      (_, index) => `a_${index.toString().padStart(22, '0')}`,
    )
    albumIds.push(albumIds[0])

    const { result } = renderHook(() => useAllProgress(albumIds), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(progressApi.batch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(progressApi.batch).mock.calls.map(([ids]) => ids.length)).toEqual([
      1_000,
      1,
    ])
    expect(Object.keys(result.current.data ?? {})).toHaveLength(1_001)
  })
})
