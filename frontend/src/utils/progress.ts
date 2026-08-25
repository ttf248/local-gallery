// 阅读进度的核心语义边界,首页两个 hero (UnreadHero / ContinueReadingHero)
// 和 useUnreadAlbums 都要用。集中在这里,避免再次写出「清空后滑到另一边」
// 之类的错位 bug。
//
// 边界定义(对一个相册):
//   - 没有 progress 记录 / total <= 0      → 未读 (isFresh)
//   - 0 < index < total                     → 在读 (isInProgress)
//   - index >= total                        → 已读完
//
// 「已读完」既不算未读,也不该算继续阅读 — 后者只覆盖「开始了但还没
// 看完」的真实在读状态。
import type { ReadingProgress } from '../api/prefs'

export interface ProgressLike {
  index: number
  total: number
}

export function isUnread(p: ProgressLike | null | undefined): boolean {
  if (!p) return true
  if (p.total <= 0) return true
  if (p.index <= 0) return true
  return false
}

export function isInProgress(p: ProgressLike | null | undefined): boolean {
  if (!p) return false
  if (p.total <= 0) return false
  if (p.index <= 0) return false
  if (p.index >= p.total) return false
  return true
}

// 类型守卫:给 useUnreadAlbums 之类已经过滤一次的代码用,避免再展开
// ProgressLike 各字段。
export function asProgressLike(p: ReadingProgress | undefined): ProgressLike | null {
  if (!p) return null
  return { index: p.index, total: p.total }
}
