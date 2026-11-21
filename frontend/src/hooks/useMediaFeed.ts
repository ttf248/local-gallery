import { useCallback, useMemo, useRef } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, isRetryableStatus, isStaleCursorError } from "../api/client";
import {
  libraryApi,
  type LibraryFeedAlbum,
  type LibraryFeedItem,
  type LibraryFeedSource,
  type MediaFeedQuery,
  type TimelineDatePrecision,
  type TimelineDateSource,
  type TimelineYear,
} from "../api/library";
import { useAppMode } from "./useAppMode";
import { libraryQueryKeys } from "../api/queryKeys";

/**
 * 跨相册的照片流。
 *
 * 首页的照片墙与年份墙都用它：照片来自不同的相册，条目自带相册信息，
 * 用户看得出出处、也回得去原来的位置。
 *
 * year / collection 两种取材会翻页，recent / random 一次给完整的一批。
 *
 * keepPrevious 让换查询时保留上一批内容：「换一批」要立刻换掉，而不是
 * 先闪一下空墙。年份墙不用它 —— 换年份时留着上一年的照片，读起来是
 * 另一年的内容。
 */
export function useMediaFeed(
  query: MediaFeedQuery,
  enabled = true,
  options?: { keepPrevious?: boolean },
) {
  const { ready } = useAppMode();
  const client = useQueryClient();
  const key = useMemo(() => libraryQueryKeys.feed(query), [query]);
  const keepPrevious = options?.keepPrevious ?? false;
  const result = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      libraryApi.mediaFeed(query, pageParam, signal).then((r) => r.page),
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: ready && enabled,
    placeholderData: keepPrevious ? (previous) => previous as never : undefined,
    // 游标失效（400）重试没有意义：库变了，重取首屏才是对的。
    // 其余也只重试值得重试的状态（5xx / 408 / 429），最多一次。
    retry: (count, error) =>
      !(error instanceof ApiError && !isRetryableStatus(error.status)) &&
      count < 1,
  });

  const fetchNextPageRef = useRef(result.fetchNextPage);
  fetchNextPageRef.current = result.fetchNextPage;

  /* 分页失败之后怎么恢复：
     - 游标失效：库变了，这一页的位置已经不对了，重试它没有意义 ——
       从头重取才是对的。已加载的那几页会重新取一遍。
     - 其余（断网、500）：重试同一页即可，继续从正确的游标往下走，
       已加载的照片不重复也不丢。 */
  const retryNextPage = useCallback(() => {
    if (isStaleCursorError(result.error)) {
      void client.resetQueries({ queryKey: key, exact: true });
      return;
    }
    void fetchNextPageRef.current({ cancelRefetch: false });
  }, [client, key, result.error]);

  const items = useMemo<LibraryFeedItem[]>(
    () => result.data?.pages.flatMap((page) => page.items) ?? [],
    [result.data],
  );
  // 相册清单取第一页：它描述的是整个取材范围，不随已加载页数变化。
  const albums = useMemo<LibraryFeedAlbum[]>(
    () => result.data?.pages[0]?.albums ?? [],
    [result.data],
  );
  // 取材范围里被选中的节点（年份对应的集合）。
  const sources = useMemo<LibraryFeedSource[]>(
    () => result.data?.pages[0]?.sources ?? [],
    [result.data],
  );
  // 时间线的年份索引：描述整条时间线，与已加载了多少页无关。
  const years = useMemo<TimelineYear[]>(
    () => result.data?.pages[0]?.years ?? [],
    [result.data],
  );
  // 时间线里「日期未知」的那一段。
  const unknown = result.data?.pages[0]?.unknown ?? 0;
  // 这一段筛选结果里的时间来源分布。
  const dateSources = useMemo<Partial<Record<TimelineDateSource, number>>>(
    () => result.data?.pages[0]?.dateSources ?? {},
    [result.data],
  );
  const datePrecisions = useMemo<
    Partial<Record<TimelineDatePrecision, number>>
  >(() => result.data?.pages[0]?.datePrecisions ?? {}, [result.data]);
  const total = result.data?.pages[0]?.total ?? items.length;

  return {
    ...result,
    items,
    albums,
    sources,
    years,
    unknown,
    dateSources,
    datePrecisions,
    total,
    query,
    /** 分页失败之后重试：游标失效时从头重取，其余重试同一页。 */
    retryNextPage,
    /** 这一次的失败是不是游标失效（库变了）。 */
    cursorInvalidated: isStaleCursorError(result.error),
  };
}
