import { describe, it, expect } from 'vitest'
import { extractYear, groupByYear } from './albumGrouping'
import type { ScanResult } from '../api/scan'

describe('extractYear', () => {
  it('parses a 4-digit year in 1900-2100 range', () => {
    expect(extractYear('2011年')).toBe(2011)
    expect(extractYear('2024年')).toBe(2024)
  })

  it('returns null when no 4-digit year', () => {
    expect(extractYear('B站')).toBeNull()
    expect(extractYear('微信下载')).toBeNull()
    expect(extractYear('')).toBeNull()
  })

  it('rejects 4-digit numbers outside the sensible year range', () => {
    expect(extractYear('1234 张')).toBeNull()
    expect(extractYear('9999年')).toBeNull()
  })
})

const baseResult = (albums: ScanResult['albums']): ScanResult => ({
  root: 'E:\\存照',
  albums,
  collections: [],
  smartCollections: [],
  albumCount: albums.length,
  collectionCount: 0,
  duration: 0,
  scannedAt: '',
})

describe('groupByYear', () => {
  it('returns empty array for null result', () => {
    expect(groupByYear(null)).toEqual([])
  })

  it('groups albums by parsed year, descending, with 其他 last', () => {
    const r = baseResult([
      mk('2011年', 102, 0),
      mk('2024年', 1193, 34),
      mk('B站', 0, 2),
      mk('2020年', 384, 19),
      mk('2024年二班', 50, 0), // 也能解析为 2024
    ])
    const g = groupByYear(r)
    expect(g.map((x) => x.label)).toEqual(['2024', '2020', '2011', '其他'])
    expect(g[0].albums.length).toBe(2)
    expect(g[0].totalFiles).toBe(1193 + 34 + 50 + 0)
  })

  it('sums imageCount + videoCount into totalFiles, splits imageTotal / videoTotal', () => {
    const r = baseResult([mk('2024年', 100, 5), mk('2024年游戏', 8, 6)])
    const g = groupByYear(r)
    expect(g).toHaveLength(1)
    expect(g[0].totalFiles).toBe(119) // 105 + 14
    expect(g[0].imageTotal).toBe(108) // 100 + 8
    expect(g[0].videoTotal).toBe(11) // 5 + 6
  })

  it('exposes up to 4 cover paths for the year card preview, filtering empties', () => {
    const r = baseResult([
      mk('2024年A', 50, 0), // coverImage '' (mk 默认)
      mk('2024年B', 30, 0),
      mk('2024年C', 20, 0),
      mk('2024年D', 10, 0),
      mk('2024年E', 5, 0),
    ])
    const g = groupByYear(r)
    expect(g).toHaveLength(1)
    // mk() 默认 coverImage=''，所以 coverPreviewPaths 应为空数组
    expect(g[0].coverPreviewPaths).toEqual([])
  })

  it('sorts albums within a year by count descending', () => {
    const r = baseResult([mk('2024年A', 10, 0), mk('2024年B', 100, 0), mk('2024年C', 50, 0)])
    const g = groupByYear(r)
    expect(g[0].albums.map((a) => a.title)).toEqual(['2024年B', '2024年C', '2024年A'])
  })

  it('non-year albums land in 其他 bucket, ordered after years', () => {
    const r = baseResult([mk('微信下载', 159, 18), mk('2023年', 100, 0)])
    const g = groupByYear(r)
    expect(g.map((x) => x.label)).toEqual(['2023', '其他'])
    expect(g[1].albums[0].title).toBe('微信下载')
  })
})

function mk(name: string, imageCount: number, videoCount: number): ScanResult['albums'][number] {
  return {
    type: 'album',
    path: `E:\\存照\\${name}`,
    name,
    coverImage: '',
    imageCount,
    videoCount,
    modTime: '2024-01-01T00:00:00Z',
  }
}
