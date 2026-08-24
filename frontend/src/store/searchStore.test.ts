import { describe, it, expect, beforeEach } from 'vitest'
import { useSearchStore } from './searchStore'

describe('searchStore - minImageCount', () => {
  beforeEach(() => {
    // 每个 case 前重置 store,避免持久化状态污染
    useSearchStore.getState().reset()
  })

  it('默认 minImageCount = 0(不过滤)', () => {
    expect(useSearchStore.getState().minImageCount).toBe(0)
  })

  it('setMinImageCount 写入 + reset 还原', () => {
    useSearchStore.getState().setMinImageCount(5)
    expect(useSearchStore.getState().minImageCount).toBe(5)
    useSearchStore.getState().reset()
    expect(useSearchStore.getState().minImageCount).toBe(0)
  })

  it('负数被 clamp 到 0', () => {
    useSearchStore.getState().setMinImageCount(-3)
    expect(useSearchStore.getState().minImageCount).toBe(0)
  })

  it('小数被 floor 到整数', () => {
    useSearchStore.getState().setMinImageCount(3.7)
    expect(useSearchStore.getState().minImageCount).toBe(3)
  })
})
