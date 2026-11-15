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
} from "../api/albums";
import { ApiError, isRetryableStatus } from "../api/client";
import { useAppMode } from "./useAppMode";

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
) {
  const client = useQueryClient();
  const { ready } = useAppMode();
  const key = useMemo(
    () => smartAlbumQueryKeys.directory(dimension),
    [dimension],
  );
  const result = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      albumsApi
        .smartDirectory(dimension, pageParam, signal)
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
