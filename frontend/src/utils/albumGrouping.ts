// 图像库按时间分组（相册浏览器模式）。
//
// 原始数据里 album / collection 的名称经常以「2011年」「2024年」开头，
// 这就是该相册代表的年份。设计成解析第一个 1900-2100 范围的 4 位数字作为年份；
// 解析不到的（B站 / 游戏 / 微信下载 / 萍乡中学 等）归到「其他」桶，放最后。
//
// 返回结果按年份倒序，每年组内按文件数倒序；这样视觉上「今年 → 去年 → 更早」自然排序。
import type { CardData } from '../components/album/AlbumCard'
import type { ScanResult } from '../api/scan'
import { albumRoute } from './path'

const OTHER_KEY = -1

export interface YearGroup {
  /** null 表示「其他」桶（解析不到年份的相册） */
  year: number | null
  /** 用于 UI 展示：「2024」或「其他」 */
  label: string
  /** 该组下的所有卡片（album + collection 混合） */
  albums: CardData[]
  /** 文件总数（图片 + 视频），用于副标题「X 个相册 · Y 张」 */
  totalFiles: number
  /** 图片总数（跨 album + collection 加和），用于 UI 区分图/视频 */
  imageTotal: number
  /** 视频总数 */
  videoTotal: number
  /**
   * Top-4 封面拼接源（按文件数倒序后取前 4），用于主页时间线的大年份卡。
   * 可能少于 4 个（空 coverPath 会被 UI 层跳过）。
   */
  coverPreviewPaths: string[]
}

export function extractYear(name: string): number | null {
  const m = name.match(/(\d{4})/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  if (y < 1900 || y > 2100) return null
  return y
}

function cardForAlbum(a: ScanResult['albums'][number]): {
  card: CardData
  images: number
  videos: number
} {
  return {
    card: {
      id: 'a:' + a.path,
      variant: 'album',
      title: a.name,
      displayTitle: a.displayName,
      subtitle: a.author || undefined,
      count: a.imageCount,
      coverPath: a.coverImage,
      to: albumRoute(a.path),
      sourceRoot: a.sourceRoot,
      sourceName: a.sourceName,
    },
    images: a.imageCount,
    videos: a.videoCount ?? 0,
  }
}

function cardForCollection(c: ScanResult['collections'][number]): {
  card: CardData
  images: number
  videos: number
} {
  const images =
    c.albums?.reduce((sum, a) => sum + a.imageCount, 0) ?? 0
  const videos =
    c.albums?.reduce((sum, a) => sum + (a.videoCount ?? 0), 0) ?? 0
  return {
    card: {
      id: 'c:' + c.path,
      variant: 'collection',
      title: c.name,
      displayTitle: c.displayName,
      subtitle: '集合',
      count: c.albumCount,
      coverPath: c.albums?.[0]?.coverImage ?? '',
      to: albumRoute(c.path),
      sourceRoot: c.sourceRoot,
      sourceName: c.sourceName,
    },
    images,
    videos,
  }
}

export function groupByYear(result: ScanResult | null): YearGroup[] {
  if (!result) return []
  const groups = new Map<number, YearGroup>()

  const add = (name: string, card: CardData, images: number, videos: number) => {
    const y = extractYear(name)
    const key = y ?? OTHER_KEY
    if (!groups.has(key)) {
      groups.set(key, {
        year: y,
        label: y !== null ? String(y) : '其他',
        albums: [],
        totalFiles: 0,
        imageTotal: 0,
        videoTotal: 0,
        coverPreviewPaths: [],
      })
    }
    const g = groups.get(key)!
    g.albums.push(card)
    g.imageTotal += images
    g.videoTotal += videos
    g.totalFiles += images + videos
  }

  for (const a of result.albums) {
    const { card, images, videos } = cardForAlbum(a)
    add(a.name, card, images, videos)
  }
  for (const c of result.collections ?? []) {
    const { card, images, videos } = cardForCollection(c)
    add(c.name, card, images, videos)
  }
  // smartCollection（标签）不参与时间分组 — 它们是「主题」而不是「时间」

  // 年份倒序；「其他」永远在最后
  const arr = [...groups.values()].sort((a, b) => {
    if (a.year === null) return 1
    if (b.year === null) return -1
    return b.year - a.year
  })
  // 同一年份内：文件多的在前（封面更吸引人的优先）
  for (const g of arr) {
    g.albums.sort((a, b) => b.count - a.count)
    g.coverPreviewPaths = g.albums
      .map((a) => a.coverPath)
      .filter((p): p is string => !!p)
      .slice(0, 4)
  }
  return arr
}
