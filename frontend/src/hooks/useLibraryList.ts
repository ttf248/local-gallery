import { useEffect, useMemo } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, isRetryableStatus } from "../api/client";
import {
  libraryApi,
  type LibraryListQuery,
  type LibraryListItem,
} from "../api/library";
import { useAppMode } from "./useAppMode";
import { libraryQueryKeys } from "../api/queryKeys";
import { useImageActivities } from "./useImageActivity";
import { decodeFavPath } from "../utils/path";
import { nodeSummaryToCard, tagSummaryToCard } from "../utils/libraryCard";

export function listItemToCard(item: LibraryListItem, query: LibraryListQuery) {
  const card =
    item.kind === "smart"
      ? tagSummaryToCard(item.tag, query.kind)
      : nodeSummaryToCard(item.node);
  if (query.parent && item.kind !== "smart" && item.node.virtual) {
    return { ...card, title: "散图", subtitle: "" };
  }
  return card;
}

export function useLibraryList(query: LibraryListQuery, enabled = true) {
  const { ready } = useAppMode();
  const client = useQueryClient();
  const key = useMemo(() => libraryQueryKeys.list(query), [query]);
  const result = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      libraryApi.overview(query, pageParam, signal).then((r) => r.page),
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: ready && enabled,
    // 游标失效（400）重试没有意义：库变了，重取首屏才是对的。
    // 其余也只重试值得重试的状态（5xx / 408 / 429），最多一次。
    retry: (count, error) =>
      !(error instanceof ApiError && !isRetryableStatus(error.status)) &&
      count < 1,
  });
  useEffect(() => {
    if (
      result.error instanceof ApiError &&
      ["stale_cursor", "invalid_cursor"].includes(result.error.code ?? "")
    ) {
      void client.resetQueries({ queryKey: key, exact: true });
    }
  }, [result.error, client, key]);
  const rawCards = useMemo(
    () =>
      result.data?.pages.flatMap((page) =>
        page.items.map((item) => listItemToCard(item, query)),
      ) ?? [],
    [result.data, query],
  );
  const progressIds = useMemo(
    () =>
      rawCards
        .filter(
          (card) => card.variant === "album" && card.contentKind === "comic",
        )
        .map((card) => decodeFavPath(card.to)),
    [rawCards],
  );
  const { data: progress } = useImageActivities(progressIds, enabled && ready);
  const cards = useMemo(
    () =>
      rawCards.map((card) => {
        if (card.variant !== "album" || card.contentKind !== "comic")
          return card;
        const activity = progress?.[decodeFavPath(card.to)];
        return activity
          ? {
              ...card,
              progress: {
                index: activity.pageIndex,
                total: card.imageCount ?? 0,
              },
            }
          : card;
      }),
    [rawCards, progress],
  );
  return {
    ...result,
    cards,
    summary: result.data?.pages[0],
    query,
    nextCursor: result.data?.pages.at(-1)?.nextCursor,
  };
}

export function listYearGroups(
  page: import("../api/library").LibraryListPage | undefined,
  query: LibraryListQuery,
): import("../utils/albumGrouping").YearGroup[] {
  return (page?.years ?? []).map((group) => ({
    year: group.year,
    label: group.year === null ? "其他" : String(group.year),
    albums: [listItemToCard(group.target, query)],
    count: group.count,
    imageTotal: group.imageTotal,
    videoTotal: group.videoTotal,
    totalFiles: group.imageTotal + group.videoTotal,
    coverPreviewPaths: group.coverImage ? [group.coverImage] : [],
    coverPreviewVersions: group.coverImageVersion ? [group.coverImageVersion] : [],
  }));
}
