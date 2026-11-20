import { useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  albumsApi,
  type SmartAlbumDimension,
  type SmartAlbumDirectoryDimension,
  type SmartAlbumSort,
} from "../api/albums";
import { ApiError, isRetryableStatus } from "../api/client";
import { useAppMode } from "./useAppMode";

/** 一次接一批分组：六十个刚好铺满两三屏瀑布流。 */
export const SMART_ALBUM_BATCH_SIZE = 60;

export const smartAlbumQueryKeys = {
  directoryRoot: ["smart-album-directory"] as const,
  directory: (dimension: SmartAlbumDirectoryDimension) =>
    ["smart-album-directory", dimension] as const,
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
  options: { limit?: number; sort?: SmartAlbumSort } = {},
) {
  const client = useQueryClient();
  const { ready } = useAppMode();
  const limit = options.limit ?? SMART_ALBUM_BATCH_SIZE;
  const sort = options.sort;
  // 批次大小与排序方式都进了查询键：首页只预览六个，完整页面一次接六十个；
  // 排序方式换了，顺序整页都变了，不能拿旧的那批接着往下拼。
  const key = useMemo(
    () => [...smartAlbumQueryKeys.directory(dimension), limit, sort] as const,
    [dimension, limit, sort],
  );
  const result = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      albumsApi
        .smartDirectory(dimension, {
          cursor: pageParam,
          limit,
          sort,
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
    analysis: result.data?.pages[0]?.analysis,
  };
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
