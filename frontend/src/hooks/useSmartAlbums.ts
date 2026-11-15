import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { albumsApi, type SmartAlbumDimension } from "../api/albums";

export const smartAlbumQueryKeys = {
  summary: (albumId: string, dimension: SmartAlbumDimension) =>
    ["smart-albums", albumId, dimension, "summary"] as const,
  media: (
    albumId: string,
    dimension: SmartAlbumDimension,
    groupId: string,
    snapshotKey: string,
  ) => ["smart-albums", albumId, dimension, groupId, snapshotKey] as const,
};

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
