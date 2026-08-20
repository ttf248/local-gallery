import { describe, it, expect } from 'vitest'
import { formatSize, formatDuration } from './format'

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(500)).toBe('500 B')
  })
  it('formats KB', () => {
    expect(formatSize(2048)).toBe('2.0 KB')
  })
  it('formats MB', () => {
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
  it('returns "—" for negative or NaN', () => {
    expect(formatSize(-1)).toBe('—')
    expect(formatSize(NaN)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('formats short videos as MM:SS', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(45)).toBe('00:45')
    expect(formatDuration(125)).toBe('02:05')
    expect(formatDuration(3599)).toBe('59:59')
  })
  it('formats long videos as H:MM:SS', () => {
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
