// 图像库按时间分组（相册浏览器模式）。
//
// 原始数据里 album / collection 的名称经常以「2011年」「2024年」开头，
// 这就是该相册代表的年份。设计成解析第一个 1900-2100 范围的 4 位数字作为年份；
// 解析不到的（B站 / 游戏 / 微信下载 / 萍乡中学 等）归到「其他」桶，放最后。
//
// 子相册归属：Collection 下的子相册（无论是 Albums 直挂还是 Collections
// 嵌套里再下钻的）都按「所属 Collection 的年份」归桶，而不是按子相册
// 自己的名字。否则 10.1国庆 没有 4 位年份，会被丢到「其他」桶，2024年
// 主页时间线就看不到 10.1国庆 了——用户反馈「我需要保留子相册导航」。
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

// 专辑摘要(轻量):Album 详情页里 CollectionDetail.albums 已经被 mapAlbum 截过,
// 缺 displayName/sourceRoot/sourceName 字段,这里提供一个兼容版,让 groupByYear
// 在子集合页也能复用同一份桶逻辑。ScanResult['albums'] 是它的超集,直接传入也行。
type AlbumLike = {
  path: string
  name: string
  imageCount: number
  videoCount?: number
  coverImage: string
  coverKind?: 'image' | 'video'
  author?: string
  displayName?: string
  sourceRoot?: string
  sourceName?: string
}

type CollectionLike = {
  path: string
  name: string
  albumCount: number
  albums?: AlbumLike[]
  collections?: CollectionLike[]
  displayName?: string
  sourceRoot?: string
  sourceName?: string
}

function cardForAlbumLike(a: AlbumLike): {
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
      imageCount: a.imageCount,
      videoCount: a.videoCount ?? 0,
      coverPath: a.coverImage,
      coverKind: a.coverKind,
      to: albumRoute(a.path),
      sourceRoot: a.sourceRoot,
      sourceName: a.sourceName,
    },
    images: a.imageCount,
    videos: a.videoCount ?? 0,
  }
}

function cardForCollection(c: CollectionLike): {
  card: CardData
  images: number
  videos: number
} {
  // 递归计算子相册的图片/视频总数,处理嵌套 Collection(深层的 Albums
  // 也算到本 Collection 头上,这样年卡显示的总数和实际下钻后能看到的
  // 一致)。
  const collect = (c: CollectionLike): { images: number; videos: number } => {
    let images = 0
    let videos = 0
    for (const a of c.albums ?? []) {
      images += a.imageCount
      videos += a.videoCount ?? 0
    }
    for (const sub of c.collections ?? []) {
      const r = collect(sub)
      images += r.images
      videos += r.videos
    }
    return { images, videos }
  }
  const { images, videos } = collect(c)
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
  return groupAlbumsAndCollectionsByYear(result.albums, result.collections)
}

// 子集合页（Album.tsx CollectionView）只需要对"当前集合下的子相册/子集合"重新分桶,
// 但 ScanResult 已经被外层包了一层。直接给一个轻量入口,避免在子页面里硬塞个伪造的
// ScanResult。
//
// albums / collections 都用 *Like 是为了兼容 Album.tsx 里 CollectionDetail
// （被 mapAlbum/mapColl 截过,缺 displayName/sourceRoot/sourceName 等字段）;
// ScanResult['albums'] / ScanResult['collections'] 是它们的超集,直接传入也行。
export function groupAlbumsAndCollectionsByYear(
  albums: AlbumLike[],
  collections?: CollectionLike[],
): YearGroup[] {
  const groups = new Map<number, YearGroup>()

  // 关键:Collection 下的所有子相册都按 Collection 的年份归桶。
  // 10.1国庆 没有 4 位年份,如果不归到 2024年 就会跑到「其他」桶,
  // 主页时间线就丢失了子相册入口。
  const add = (yearName: string, card: CardData, images: number, videos: number) => {
    const y = extractYear(yearName)
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

  for (const a of albums) {
    // 跳过「散图」虚拟相册(扫描器在 Collection 有顶层文件+子目录时
    // 插入的虚拟相册,Path 以 /.loose 或 \\.loose 结尾)。它的图数已经
    // 算在所属 Collection 的 imageTotal 里,不应该再独立出现在年份桶
    // 里(否则主页会显示两个 2024年 入口)。
    if (/\.loose(?:$|[\\/])/.test(a.path)) continue
    const { card, images, videos } = cardForAlbumLike(a)
    add(a.name, card, images, videos)
  }
  for (const c of collections ?? []) {
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
