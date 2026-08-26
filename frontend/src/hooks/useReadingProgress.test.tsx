import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { progressApi } from '../api/prefs'
import { useMarkAllAsRead } from './useReadingProgress'

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
