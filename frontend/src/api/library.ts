import { api } from "./client";

export const LIBRARY_PAGE_LIMIT = 200;
export const LIBRARY_NODE_BATCH_LIMIT = 500;

export interface LibraryStatistics {
  rootCount: number;
  albumCount: number;
  collectionCount: number;
  tagCount: number;
  warningCount: number;
}

export interface LibraryRootSummary {
  id: string;
  name: string;
  childCount: number;
}

export interface LibraryManifest {
  revision: number;
  scannedAt: string;
  duration: number;
  roots: LibraryRootSummary[];
  statistics: LibraryStatistics;
}

export interface LibraryNodeSummary {
  id: string;
  kind: "album" | "collection";
  name: string;
  displayName: string;
  sourceRoot?: string;
  sourceName?: string;
  author?: string;
  coverImage?: string;
  coverImages: string[];
  coverKind?: "image" | "video";
  imageCount?: number;
  videoCount?: number;
  mediaCount?: number;
  albumCount?: number;
  childCount?: number;
  folderSize?: number;
  tags?: string[];
  modTime?: string;
  date?: string;
  dateSource?: "captured" | "folder" | "modified";
  virtual?: boolean;
  hasCustomCover?: boolean;
}

export interface LibraryMediaItem {
  id: string;
  kind: "image" | "video";
  name: string;
  index: number;
  kindIndex: number;
}

export interface LibraryTagSummary {
  tag: string;
  albumCount: number;
  coverImage?: string;
  coverImages: string[];
}

export interface LibraryPage<T> {
  revision: number;
  items: T[];
  total: number;
  nextCursor?: string;
}

export interface LibraryNodeQueryResult {
  revision: number;
  items: LibraryNodeSummary[];
  missing: string[];
}

interface PageResponse<T> {
  ok: boolean;
  page: LibraryPage<T>;
}

export class LibraryRevisionChangedError extends Error {
  constructor() {
    super("library revision changed while loading pages");
  }
}

async function collectPages<T>(
  load: (cursor?: string) => Promise<PageResponse<T>>,
): Promise<LibraryPage<T>> {
  let cursor: string | undefined;
  let revision: number | undefined;
  let total = 0;
  const items: T[] = [];
  do {
    const response = await load(cursor);
    const page = response.page;
    if (revision !== undefined && page.revision !== revision) {
      throw new LibraryRevisionChangedError();
    }
    revision = page.revision;
    total = page.total;
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return { revision: revision ?? 0, items, total };
}

async function queryNodes(ids: string[]): Promise<LibraryNodeQueryResult> {
  if (ids.length === 0) return { revision: 0, items: [], missing: [] };
  let revision: number | undefined;
  const items: LibraryNodeSummary[] = [];
  const missing: string[] = [];
  for (
    let offset = 0;
    offset < ids.length;
    offset += LIBRARY_NODE_BATCH_LIMIT
  ) {
    const response = await api<{
      ok: boolean;
      result: LibraryNodeQueryResult;
    }>("/api/library/nodes/query", {
      method: "POST",
      body: { ids: ids.slice(offset, offset + LIBRARY_NODE_BATCH_LIMIT) },
    });
    if (revision !== undefined && response.result.revision !== revision) {
      throw new LibraryRevisionChangedError();
    }
    revision = response.result.revision;
    items.push(...response.result.items);
    missing.push(...response.result.missing);
  }
  return { revision: revision ?? 0, items, missing };
}

export const libraryApi = {
  manifest: () =>
    api<{ ok: boolean; manifest: LibraryManifest }>("/api/library/manifest"),
  albumPage: (cursor?: string, limit = LIBRARY_PAGE_LIMIT) =>
    api<PageResponse<LibraryNodeSummary>>("/api/albums", {
      params: { cursor, limit },
    }),
  childrenPage: (
    parentId: string,
    cursor?: string,
    limit = LIBRARY_PAGE_LIMIT,
  ) =>
    api<PageResponse<LibraryNodeSummary>>(
      `/api/library/${encodeURIComponent(parentId)}/children`,
      { params: { cursor, limit } },
    ),
  mediaPage: (albumId: string, cursor?: string, limit = LIBRARY_PAGE_LIMIT) =>
    api<PageResponse<LibraryMediaItem>>(
      `/api/albums/${encodeURIComponent(albumId)}/media`,
      { params: { cursor, limit } },
    ),
  tagPage: (cursor?: string, limit = LIBRARY_PAGE_LIMIT) =>
    api<PageResponse<LibraryTagSummary>>("/api/tags", {
      params: { cursor, limit },
    }),
  tagAlbumsPage: (tag: string, cursor?: string, limit = LIBRARY_PAGE_LIMIT) =>
    api<PageResponse<LibraryNodeSummary>>(
      `/api/tags/${encodeURIComponent(tag)}/albums`,
      { params: { cursor, limit } },
    ),
  allAlbums: () => collectPages((cursor) => libraryApi.albumPage(cursor)),
  allChildren: (parentId: string) =>
    collectPages((cursor) => libraryApi.childrenPage(parentId, cursor)),
  allMedia: (albumId: string) =>
    collectPages((cursor) => libraryApi.mediaPage(albumId, cursor)),
  allTags: () => collectPages((cursor) => libraryApi.tagPage(cursor)),
  allTagAlbums: (tag: string) =>
    collectPages((cursor) => libraryApi.tagAlbumsPage(tag, cursor)),
  queryNodes,
};
