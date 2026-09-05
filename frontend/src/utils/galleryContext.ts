// Gallery 上下文：在多个列表页（主页 / 最近 / 收藏 / 智能合集 / 单本详情）点开一个
// 相册进入画廊时，把「从这里来的列表」存下来；画廊内 `N / P` 快捷键就在
// 这个列表里上下移动，让「随便翻翻收藏」的连续阅读体验更顺。
//
// 写入由各列表页负责，读取由 Gallery 负责。同一 session 内有效，
// 关闭标签页或点开完全不同的来源时由写入方覆盖。

export type GallerySource =
  | { type: 'home'; section?: 'inProgress' | 'fresh' | 'rewind' | 'recent' | 'topAuthors' | 'all' }
  | { type: 'favorites' }
  | { type: 'recents' }
  | { type: 'unread' }
  | { type: 'tag'; tag: string }
  | { type: 'author'; author: string } // 旧名，等价 tag
  | { type: 'album'; parentPath: string }
  | { type: 'collection'; parentPath: string }
  | { type: 'search' }
  | { type: 'shuffle' }
  | { type: 'direct' }

export interface GalleryContextEntry {
  /** 列表元素的稳定资源 ID：用于与当前画廊 path 对比。 */
  key: string
  /** 跳转 URL（相对路径）。 */
  to: string
  /** 显示用名称（列表页上展示的标题）。 */
  name: string
}

export interface GalleryContext {
  source: GallerySource
  /** 当前列表的全部条目。 */
  list: GalleryContextEntry[]
  /** 进入画廊那一刻所在列表里的索引；N/P 用它定位上下本。 */
  index: number
  /** 进入时间，用于诊断 / 显示「从某处点开」。 */
  openedAt: number
}

const KEY = 'local-gallery-context'

/** 写入：覆盖式（最近一次导航的列表为准）。 */
export function setGalleryContext(ctx: Omit<GalleryContext, 'openedAt'>): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...ctx, openedAt: Date.now() } satisfies GalleryContext),
    )
  } catch {
    // sessionStorage 不可用时静默退化
  }
}

/** 读取最近一次上下文；读不到返回 null。 */
export function getGalleryContext(): GalleryContext | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GalleryContext
    if (!parsed || !Array.isArray(parsed.list)) return null
    return parsed
  } catch {
    return null
  }
}
