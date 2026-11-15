import { describe, it, expect } from 'vitest'
import { formatSize, formatDuration } from './format'

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(500)).toBe('500 B')
    expect(formatSize(1023)).toBe('1023 B')
  })
  it('formats KB', () => {
    expect(formatSize(1024)).toBe('1 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(2048)).toBe('2 KB')
  })
  it('formats MB', () => {
    expect(formatSize(1024 * 1024)).toBe('1 MB')
    expect(formatSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatSize(50 * 1024 * 1024)).toBe('50 MB')
  })
  it('formats GB', () => {
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe('2 GB')
  })
  it('strips trailing .0', () => {
    expect(formatSize(10 * 1024 * 1024)).toBe('10 MB')
    expect(formatSize(100 * 1024 * 1024)).toBe('100 MB')
  })
  it('returns "—" for negative or NaN', () => {
    expect(formatSize(-1)).toBe('—')
    expect(formatSize(NaN)).toBe('—')
    expect(formatSize(Infinity)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('formats short videos as MM:SS', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(45)).toBe('00:45')
    expect(formatDuration(125)).toBe('02:05')
    expect(formatDuration(3599)).toBe('59:59')
  })
  it('formats long videos as H∕MM:SS', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3661)).toBe('1:01:01')
    expect(formatDuration(7325)).toBe('2:02:05')
  })
  it('handles fractional seconds by flooring', () => {
    expect(formatDuration(59.9)).toBe('00:59')
  })
  it('returns "—" for invalid input', () => {
    expect(formatDuration(undefined)).toBe('—')
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(NaN)).toBe('—')
    expect(formatDuration(-1)).toBe('—')
  })
})
