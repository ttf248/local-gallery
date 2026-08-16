import { describe, it, expect } from 'vitest'
import { formatBytes } from './cache'

describe('formatBytes', () => {
  it('formats 0', () => {
    expect(formatBytes(0)).toBe('0 B')
  })
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })
  it('formats KB', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })
  it('formats MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
  })
  it('formats GB', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2 GB')
  })
  it('strips trailing .0', () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
    expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB')
  })
  it('handles invalid', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(NaN)).toBe('—')
    expect(formatBytes(Infinity)).toBe('—')
  })
})
