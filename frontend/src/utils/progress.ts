// 阅读进度的核心语义边界,首页两个 hero (UnreadHero / ContinueReadingHero)
// 和 useUnreadAlbums 都要用。集中在这里,避免再次写出「清空后滑到另一边」
// 之类的错位 bug。
//
// 边界定义（index 是从 0 开始的页码）：
//   - 没有 progress 记录                    → 未读 (isFresh)
//   - 0 <= index < total - 1                → 在读 (isInProgress)
//   - index >= total - 1                    → 已读完
//
// total <= 0 是无有效媒体的异常/空记录，按未读处理；单页相册一旦保存
// index=0，就已经满足「到达最后一页」，因此算已读完。
//
// 「已读完」既不算未读,也不该算继续阅读 — 后者只覆盖「开始了但还没
// 看完」的真实在读状态。

export interface ProgressLike {
  index: number;
  total: number;
}

// 活动只接受实际露出的末页。首次测量和正在定位时没有可保存的位置。
export function displayedPageIndex(
  lastVisible: number | undefined,
  total: number,
): number | null {
  if (
    lastVisible === undefined ||
    !Number.isInteger(lastVisible) ||
    lastVisible < 0 ||
    lastVisible >= total
  )
    return null;
  return lastVisible;
}

export function isUnread(p: ProgressLike | null | undefined): boolean {
  if (!p) return true;
  if (p.total <= 0) return true;
  return false;
}

export function isInProgress(p: ProgressLike | null | undefined): boolean {
  if (!p) return false;
  if (p.total <= 0) return false;
  if (p.index < 0) return false;
  return p.index < p.total - 1;
}

export function isCompleted(p: ProgressLike | null | undefined): boolean {
  if (!p || p.total <= 0) return false;
  return p.index >= p.total - 1;
}

export function progressPercent(
  p: ProgressLike | null | undefined,
): number | null {
  if (!p || p.total <= 0) return null;
  const lastIndex = p.total - 1;
  if (lastIndex === 0) return 100;
  const boundedIndex = Math.max(0, Math.min(lastIndex, p.index));
  return Math.round((boundedIndex / lastIndex) * 100);
}
