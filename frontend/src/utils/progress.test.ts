import { describe, it, expect } from 'vitest'
import { isUnread, isInProgress, asProgressLike } from './progress'

describe('progress 语义边界', () => {
  describe('isUnread', () => {
    it('无记录算未读', () => {
      expect(isUnread(null)).toBe(true)
      expect(isUnread(undefined)).toBe(true)
    })
    it('total=0 算未读（空相册）', () => {
      expect(isUnread({ index: 0, total: 0 })).toBe(true)
    })
    it('index=0 算未读（刚开始）', () => {
      expect(isUnread({ index: 0, total: 50 })).toBe(true)
    })
    it('index>0 不算未读（在读）', () => {
      expect(isUnread({ index: 5, total: 50 })).toBe(false)
    })
    it('index==total 不算未读（已读完）', () => {
      expect(isUnread({ index: 50, total: 50 })).toBe(false)
    })
  })

  describe('isInProgress', () => {
    it('无记录不算在读', () => {
      expect(isInProgress(null)).toBe(false)
      expect(isInProgress(undefined)).toBe(false)
    })
    it('total=0 不算在读（避免除零 / 空相册）', () => {
      expect(isInProgress({ index: 5, total: 0 })).toBe(false)
    })
    it('index=0 不算在读', () => {
      expect(isInProgress({ index: 0, total: 50 })).toBe(false)
    })
    // 关键回归测试:已读完不应该再出现在「继续阅读」区。
    it('index==total 不算在读（已读完，不进继续阅读）', () => {
      expect(isInProgress({ index: 50, total: 50 })).toBe(false)
    })
    it('index>total 不算在读（异常数据,不显示）', () => {
      expect(isInProgress({ index: 100, total: 50 })).toBe(false)
    })
    it('0<index<total 才算在读', () => {
      expect(isInProgress({ index: 1, total: 50 })).toBe(true)
      expect(isInProgress({ index: 25, total: 50 })).toBe(true)
      expect(isInProgress({ index: 49, total: 50 })).toBe(true)
    })
  })

  describe('asProgressLike', () => {
    it('undefined → null', () => {
      expect(asProgressLike(undefined)).toBeNull()
    })
    it('ReadingProgress → 收敛到 ProgressLike', () => {
      expect(
        asProgressLike({
          albumId: 'a_0000000000000000000001',
          index: 5,
          total: 50,
          scroll: 0,
          updated: '2026-01-01T00:00:00Z',
        }),
      ).toEqual({ index: 5, total: 50 })
    })
  })
})
