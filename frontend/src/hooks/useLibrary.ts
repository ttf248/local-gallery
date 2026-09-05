import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { LibraryRevisionChangedError, libraryApi } from "../api/library";

export const libraryQueryKeys = {
  root: ["library"] as const,
  manifest: () => [...libraryQueryKeys.root, "manifest"] as const,
  albums: () => [...libraryQueryKeys.root, "albums"] as const,
  children: (parentId: string) =>
    [...libraryQueryKeys.root, "children", parentId] as const,
  media: (albumId: string) =>
    [...libraryQueryKeys.root, "media", albumId] as const,
  tags: () => [...libraryQueryKeys.root, "tags"] as const,
  tagAlbums: (tag: string) =>
    [...libraryQueryKeys.root, "tag-albums", tag] as const,
  nodes: (ids: string[]) =>
    [...libraryQueryKeys.root, "nodes", ...ids] as const,
};

export function useLibraryManifest() {
  return useQuery({
    queryKey: libraryQueryKeys.manifest(),
    queryFn: () => libraryApi.manifest(),
  });
}

export function useLibraryAlbums() {
  return useQuery({
    queryKey: libraryQueryKeys.albums(),
    queryFn: () => libraryApi.allAlbums(),
  });
}

export function useLibraryChildren(
  parentId: string,
  expectedRevision?: number,
) {
  return useQuery({
    queryKey: [...libraryQueryKeys.children(parentId), expectedRevision],
    queryFn: async () => {
      const page = await libraryApi.allChildren(parentId);
      if (
        expectedRevision !== undefined &&
        page.revision !== expectedRevision
      ) {
        throw new LibraryRevisionChangedError();
      }
      return page;
    },
    enabled: parentId.length > 0,
  });
}

export function useAlbumMedia(albumId: string, expectedRevision?: number) {
  return useQuery({
    queryKey: [...libraryQueryKeys.media(albumId), expectedRevision],
    queryFn: async () => {
      const page = await libraryApi.allMedia(albumId);
      if (
        expectedRevision !== undefined &&
        page.revision !== expectedRevision
      ) {
        throw new LibraryRevisionChangedError();
      }
      return page;
    },
    enabled: albumId.length > 0,
  });
}

export function useLibraryTags(enabled = true, expectedRevision?: number) {
  return useQuery({
    queryKey: [...libraryQueryKeys.tags(), expectedRevision],
    queryFn: async () => {
      const page = await libraryApi.allTags();
      if (
        expectedRevision !== undefined &&
        page.revision !== expectedRevision
      ) {
        throw new LibraryRevisionChangedError();
      }
      return page;
    },
    enabled,
  });
}

export function useTagAlbums(tag: string) {
  return useQuery({
    queryKey: libraryQueryKeys.tagAlbums(tag),
    queryFn: () => libraryApi.allTagAlbums(tag),
    enabled: tag.length > 0,
  });
}

export function useLibraryNodes(ids: string[]) {
  return useQuery({
    queryKey: libraryQueryKeys.nodes(ids),
    queryFn: () => libraryApi.queryNodes(ids),
    enabled: ids.length > 0,
  });
}

// 首页只装配 manifest、各根直属节点与标签摘要，不加载嵌套树或媒体数组。
export function useLibraryOverview() {
  const manifestQuery = useLibraryManifest();
  const manifest = manifestQuery.data?.manifest;
  const roots = manifest?.roots ?? [];
  const childrenQueries = useQueries({
    queries: roots.map((root) => ({
      queryKey: [
        ...libraryQueryKeys.children(root.id),
        manifest?.revision,
      ] as const,
      queryFn: async () => {
        const page = await libraryApi.allChildren(root.id);
        if (page.revision !== manifest?.revision) {
          throw new LibraryRevisionChangedError();
        }
        return page;
      },
    })),
  });
  const tagsQuery = useLibraryTags(!!manifest, manifest?.revision);
  const nodes = useMemo(
    () => childrenQueries.flatMap((query) => query.data?.items ?? []),
    [childrenQueries],
  );

  return {
    manifest,
    nodes,
    tags: tagsQuery.data?.items ?? [],
    isLoading:
      manifestQuery.isLoading ||
      childrenQueries.some((query) => query.isLoading) ||
      tagsQuery.isLoading,
    isError:
      manifestQuery.isError ||
      childrenQueries.some((query) => query.isError) ||
      tagsQuery.isError,
  };
}
