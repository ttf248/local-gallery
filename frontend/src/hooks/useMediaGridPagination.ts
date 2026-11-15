import { useCallback, useEffect, useRef, useState } from "react";
import type { ListRange } from "react-virtuoso";

interface Options {
  loadedCount: number;
  hasNextPage: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

/** 保留完整滚动长度，同时在视口接近已加载媒体边界时预取下一页。 */
export function useMediaGridPagination({
  loadedCount,
  hasNextPage,
  isLoadingMore,
  onLoadMore,
}: Options) {
  const [endIndex, setEndIndex] = useState(-1);
  const rangeChanged = useCallback((range: ListRange) => {
    setEndIndex(range.endIndex);
  }, []);

  // 取下一页的回调放进 ref，不进依赖数组。
  //
  // 调用方多半给的是一句内联的箭头函数（或者依赖一个每次渲染都换新的
  // 查询对象），它的身份每次渲染都变。挂在依赖数组上，条件一满足就会
  // 每渲染一次都取一次下一页 —— 请求本身会被查询层合并，但多出来的
  // 调用让「取下一页」这件事没法用一个条件说清。
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    // 占位槽已覆盖整本相册，endReached 只会在整本末尾触发。
    // 跳到远处占位区时，每页完成后也要重新检查，直到覆盖当前视口。
    if (
      endIndex >= 0 &&
      endIndex >= loadedCount - 24 &&
      hasNextPage &&
      !isLoadingMore
    ) {
      onLoadMoreRef.current();
    }
  }, [endIndex, loadedCount, hasNextPage, isLoadingMore]);

  return rangeChanged;
}
