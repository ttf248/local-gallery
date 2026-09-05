import { useQuery } from "@tanstack/react-query";
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

export function useLibraryTags(enabled = true) {
  return useQuery({
    queryKey: libraryQueryKeys.tags(),
    queryFn: () => libraryApi.allTags(),
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
