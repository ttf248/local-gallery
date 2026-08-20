import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ScanProgress from './ScanProgress'
import type { ProgressEvent } from '../../api/scan'

// 进度事件构造助手
function makeProgress(overrides: Partial<ProgressEvent> = {}): ProgressEvent {
  return {
    scanId: 'scan-1',
    progress: 42,
    status: 'running',
    phase: 'scanning',
    currentPath: 'E:\\存照\\2024年',
    albumsFound: 7,
    elapsedMs: 1500,
    ...overrides,
  }
}

describe('ScanProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when progress is null', () => {
    const { container } = render(<ScanProgress progress={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders running state with progress bar and percentage', () => {
    render(<ScanProgress progress={makeProgress({ progress: 35 })} />)
    expect(screen.getByText('扫描中')).toBeInTheDocument()
    expect(screen.getByText('35%')).toBeInTheDocument()
    // 本数在折叠态有 md:inline 断点（移动端隐藏），
    // jsdom 默认窄视口所以单独验：容器 DOM 中存在对应 span
    expect(document.querySelector('span.tabular-nums.text-fg-subtle')).toBeTruthy()
  })

  it('renders cancel button when onCancel is provided', () => {
    const onCancel = vi.fn()
    render(<ScanProgress progress={makeProgress()} onCancel={onCancel} />)
    const cancelBtn = screen.getByRole('button', { name: '取消扫描' })
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('expands details on click and shows current path / phase / elapsed', () => {
    render(
      <ScanProgress
        progress={makeProgress({
          phase: 'smart-grouping',
          currentPath: 'E:\\存照\\some\\deep\\folder',
        })}
      />,
    )
    // 折叠态：点击 "展开扫描详情" 按钮
    const toggleBtn = screen.getByRole('button', { name: '展开扫描详情' })
    fireEvent.click(toggleBtn)
    // 展开后：阶段 + 完整路径 + 耗时
    expect(screen.getByText('聚合标签中')).toBeInTheDocument()
    expect(
      screen.getByText('E:\\存照\\some\\deep\\folder'),
    ).toBeInTheDocument()
    expect(screen.getByText('1.5s')).toBeInTheDocument()
  })

  it('keeps terminal state visible for 3s then auto-hides', () => {
    const { rerender, container } = render(
      <ScanProgress progress={makeProgress({ status: 'running' })} />,
    )
    expect(screen.getByText('扫描中')).toBeInTheDocument()
    // 切到 complete
    rerender(
      <ScanProgress
        progress={makeProgress({ status: 'complete', progress: 100, elapsedMs: 3200 })}
      />,
    )
    expect(screen.getByText('扫描完成')).toBeInTheDocument()
    // 折叠态文案："{albumsFound} 本 · {elapsedSec}s" → "7 本 · 3.2s"
    expect(screen.getByText(/7.*3\.2s/)).toBeInTheDocument()
    // 3s 后滑出
    act(() => {
      vi.advanceTimersByTime(3100)
    })
    expect(container.firstChild).toBeNull()
  })

  it('renders error state with the error message in expanded view', () => {
    render(
      <ScanProgress
        progress={makeProgress({
          status: 'error',
          error: '媒体根不存在: E:\\nope',
        })}
      />,
    )
    expect(screen.getByText('扫描失败')).toBeInTheDocument()
    // error 详情只在展开后显示
    const toggleBtn = screen.getByRole('button', { name: '展开扫描详情' })
    fireEvent.click(toggleBtn)
    expect(screen.getByText('媒体根不存在: E:\\nope')).toBeInTheDocument()
  })

  it('renders cancelled state', () => {
    render(
      <ScanProgress
        progress={makeProgress({ status: 'cancelled', elapsedMs: 800 })}
      />,
    )
    expect(screen.getByText('已取消')).toBeInTheDocument()
    // 折叠态文案："{albumsFound} 本 · {elapsedSec}s" → "7 本 · 0.8s"
    expect(screen.getByText(/7.*0\.8s/)).toBeInTheDocument()
  })

  it('clamps progress width to 100% even when value exceeds 100', () => {
    render(<ScanProgress progress={makeProgress({ progress: 150 })} />)
    // 进度条 inner span 用 clamp 后的 pct (100)
    const bar = document.querySelector('[style*="width"]') as HTMLElement
    expect(bar).toBeInTheDocument()
    expect(bar.style.width).toBe('100%')
  })

  it('has accessible role=status for screen readers', () => {
    render(<ScanProgress progress={makeProgress()} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
