import { useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  albumsApi,
  type SmartAlbumDimension,
  type SmartAlbumDirectoryDimension,
} from "../api/albums";
import { ApiError, isRetryableStatus } from "../api/client";
import { useAppMode } from "./useAppMode";

/** 一次接一批分组：六十个刚好铺满两三屏瀑布流。 */
export const SMART_ALBUM_BATCH_SIZE = 60;

/** 四个维度，顺序与目录页的页签一致。 */
export const SMART_ALBUM_DIMENSIONS: readonly SmartAlbumDimension[] = [
  "time",
  "place",
  "people",
  "scene",
];

export const smartAlbumQueryKeys = {
  directoryRoot: ["smart-album-directory"] as const,
  directory: (dimension: SmartAlbumDirectoryDimension) =>
    ["smart-album-directory", dimension] as const,
  dimensionCount: (dimension: SmartAlbumDimension) =>
    ["smart-album-directory", dimension, "count"] as const,
  summary: (albumId: string, dimension: SmartAlbumDimension) =>
    ["smart-albums", albumId, dimension, "summary"] as const,
  media: (
    albumId: string,
    dimension: SmartAlbumDimension,
    groupId: string,
    snapshotKey: string,
  ) => ["smart-albums", albumId, dimension, groupId, snapshotKey] as const,
};

export function useSmartAlbumDirectory(
  dimension: SmartAlbumDirectoryDimension,
  enabled: boolean,
  options: { limit?: number } = {},
) {
  const client = useQueryClient();
  const { ready } = useAppMode();
  const limit = options.limit ?? SMART_ALBUM_BATCH_SIZE;
  // 批次大小进了查询键：首页只预览十二个，完整页面一次接六十个，
  // 两者共用一个键会拿到对方那批数据。
  const key = useMemo(
    () => [...smartAlbumQueryKeys.directory(dimension), limit] as const,
    [dimension, limit],
  );
  const result = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      albumsApi
        .smartDirectory(dimension, {
          cursor: pageParam,
          limit,
          signal,
        })
        .then((response) => response.page),
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: ready && enabled,
    staleTime: 30_000,
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

  return {
    ...result,
    items: result.data?.pages.flatMap((page) => page.items) ?? [],
    total: result.data?.pages[0]?.total,
  };
}

/**
 * 各维度有多少组。
 *
 * 目录接口的 total 就是分组数，因此每个维度只取一条（limit=1）就够数。
 * 「全部」是四个维度之和，不必再单独问一次 —— 那一次要把全库缓存读两遍。
 */
export function useSmartAlbumDimensionCounts(enabled: boolean) {
  const { ready } = useAppMode();
  const results = useQueries({
    queries: SMART_ALBUM_DIMENSIONS.map((dimension) => ({
      queryKey: smartAlbumQueryKeys.dimensionCount(dimension),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        albumsApi
          .smartDirectory(dimension, { limit: 1, signal })
          .then((response) => response.page.total),
      staleTime: 60_000,
      enabled: ready && enabled,
    })),
  });

  const counts = useMemo(() => {
    const result: Partial<Record<SmartAlbumDimension, number>> = {};
    SMART_ALBUM_DIMENSIONS.forEach((dimension, index) => {
      const total = results[index]?.data;
      if (typeof total === "number") result[dimension] = total;
    });
    return result;
  }, [results]);

  const total = useMemo(() => {
    const values = Object.values(counts);
    if (values.length !== SMART_ALBUM_DIMENSIONS.length) return undefined;
    return values.reduce((sum, value) => sum + value, 0);
  }, [counts]);

  return { counts, total };
}

export function useSmartAlbumGroups(
  albumId: string,
  dimension: SmartAlbumDimension,
  enabled: boolean,
) {
  return useQuery({
    queryKey: smartAlbumQueryKeys.summary(albumId, dimension),
    queryFn: ({ signal }) => albumsApi.smartGroups(albumId, dimension, signal),
    enabled: enabled && albumId.length > 0,
    staleTime: 30_000,
  });
}

export function useSmartAlbumGroupMedia(
  albumId: string,
  dimension: SmartAlbumDimension,
  groupId: string,
  snapshotKey: string,
) {
  return useInfiniteQuery({
    queryKey: smartAlbumQueryKeys.media(
      albumId,
      dimension,
      groupId,
      snapshotKey,
    ),
    queryFn: async ({ pageParam, signal }) => {
      const response = await albumsApi.smartGroupMedia(
        albumId,
        dimension,
        groupId,
        snapshotKey,
        pageParam,
        signal,
      );
      return response.page;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: albumId.length > 0 && groupId.length > 0 && snapshotKey.length > 0,
  });
}
