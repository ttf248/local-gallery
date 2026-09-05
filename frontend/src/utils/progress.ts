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
import type { ImageActivity } from "../api/activity";

export interface ProgressLike {
  index: number;
  total: number;
}

export type GalleryDisplayMode = "single" | "continuous" | "double";

export interface VisiblePageRange {
  startIndex: number;
  endIndex: number;
}

// 活动页码表示当前视图中已展示的最末页；UI 的 index 在双页/连续模式下
// 只是左页或可见区首项，不能直接用于完成判定。
export function displayedPageIndex(
  mode: GalleryDisplayMode,
  index: number,
  total: number,
  visibleRange?: VisiblePageRange,
): number {
  if (total <= 0) return 0;
  let pageIndex = index;
  if (mode === "double") {
    pageIndex = index + 1;
  } else if (mode === "continuous" && visibleRange?.startIndex === index) {
    pageIndex = visibleRange.endIndex;
  }
  return Math.max(0, Math.min(total - 1, Math.floor(pageIndex)));
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

// 类型守卫:给 useUnreadAlbums 之类已经过滤一次的代码用,避免再展开
// ProgressLike 各字段。
export function asProgressLike(
  activity: ImageActivity | undefined,
  currentTotal?: number,
): ProgressLike | null {
  // 服务端不会返回 pageCount <= 0；这里仍拒绝异常/旧缓存响应，避免当前
  // 相册总数把一条无效活动“修复”成已开始状态。
  if (!activity || activity.pageCount <= 0) return null;
  return {
    index: activity.pageIndex,
    total: currentTotal ?? activity.pageCount,
  };
}
