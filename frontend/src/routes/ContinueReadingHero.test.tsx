import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContinueReadingHero } from './Home'
import { useFavorites } from '../hooks/useFavorites'
import { useAllProgress } from '../hooks/useReadingProgress'

// ContinueReadingHero 不直接调这些 hook, 但 Home 父组件会, 这里 mock 避免
// 整个链路被触发出意外副作用。
vi.mock('../hooks/useFavorites', () => ({
  useFavorites: vi.fn(),
}))
vi.mock('../hooks/useReadingProgress', () => ({
  useAllProgress: vi.fn(),
}))

function makeCard(path: string, name: string, index: number, total: number) {
  return {
    id: 'i:' + path,
    variant: 'album' as const,
    title: name,
    count: total,
    imageCount: total,
    videoCount: 0,
    coverPath: path + '/cover.jpg',
    coverKind: 'image' as const,
    to: `/albums/${encodeURIComponent(path)}`,
    progress: { index, total },
  }
}

function renderHero(cards: ReturnType<typeof makeCard>[]) {
  const onContinue = vi.fn()
  const onRemove = vi.fn()
  const onClearAll = vi.fn()
  return {
    onContinue,
    onRemove,
    onClearAll,
    ...render(
      <ContinueReadingHero
        cards={cards}
        onContinue={onContinue}
        onRemove={onRemove}
        onClearAll={onClearAll}
      />,
    ),
  }
}

describe('ContinueReadingHero', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
  })

  it('显示进度中相册数 + 第一张的进度文本', () => {
    renderHero([
      makeCard('/a', 'A', 5, 20), // 5/20
    ])
    // 标题:1 本还没看完
    const heroSection = screen.getByTestId('continue-hero')
    expect(heroSection.textContent).toMatch(/1\s*本还没看完/)
    // 进度文本 看到 6/20(index+1 / total)
    expect(screen.getByText(/看到\s*6\s*\/\s*20/)).toBeInTheDocument()
  })

  it('点击卡片触发 onContinue + 拿到对应 card', () => {
    const { onContinue } = renderHero([
      makeCard('/a', 'A', 5, 20),
      makeCard('/b', 'B', 12, 30),
    ])
    // 外层是 role=button 的 div，div 内部有 X 真 button。
    // 找 "13 / 30" 那个 progress 文本（标记第 2 张 B 的卡），回溯到 role=button 容器。
    const progressText = screen.getByText(/看到\s*13\s*\/\s*30/)
    const bCard = progressText.closest('[role="button"]') as HTMLElement
    fireEvent.click(bCard)
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(onContinue.mock.calls[0][0].title).toBe('B')
    expect(onContinue.mock.calls[0][0].progress?.index).toBe(12)
  })

  it('cards 超过 6 张时只显示前 6 张', () => {
    const eight = Array.from({ length: 8 }, (_, i) =>
      makeCard(`/p${i}`, `P${i}`, i, 30),
    )
    const { container } = renderHero(eight)
    const cardButtons = container.querySelectorAll('button[aria-label^="将"][aria-label$="标记为已读"]')
    // 8 张里网格渲染只取前 6。每张卡有 1 个 X button 标 aria-label
    // "将X标记为已读"，所以正好 6 个
    expect(cardButtons.length).toBe(6)
  })

  it('空 cards 仍渲染(由 Home 条件决定是否显示)', () => {
    renderHero([])
    const heroSection = screen.getByTestId('continue-hero')
    expect(heroSection.textContent).toMatch(/0\s*本还没看完/)
  })

  it('点 X 触发 onRemove 且不冒泡到外层 onContinue', () => {
    const { onContinue, onRemove } = renderHero([
      makeCard('/a', 'A', 5, 20),
    ])
    const xBtn = screen.getByLabelText('将A标记为已读')
    fireEvent.click(xBtn)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove.mock.calls[0][0].title).toBe('A')
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('点 清空 链接触发 onClearAll', () => {
    const { onClearAll } = renderHero([makeCard('/a', 'A', 1, 10)])
    const clearBtn = screen.getByTitle(/把当前所有继续阅读相册标记为已读/)
    fireEvent.click(clearBtn)
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })
})
