import { useEffect } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  LibraryRevisionChangedError,
  libraryApi,
  type AlbumFilterQuery,
  type LibraryNodeSummary,
} from "../api/library";
import { activityAffectedKeys, libraryQueryKeys } from "../api/queryKeys";
import { ACTIVITY_CHANGED_EVENT } from "../api/activity";
import { useUIStore } from "../store/uiStore";
import { useAppMode } from "./useAppMode";
import type { AppMode } from "../api/library";

export function useMultiRoot(mode: AppMode) {
  return useUIStore((s) => s.multiRootByMode[mode]);
}
export function useLibraryManifest() {
  const query = useQuery({
    queryKey: libraryQueryKeys.manifest(),
    queryFn: ({ signal }) => libraryApi.manifest(signal),
  });
  // 多根时才需要在卡片上标来源：单一根下每张卡片都挂「来自 X」是噪音。
  const roots = query.data?.manifest.roots;
  const photo =
    (roots?.filter((root) => (root.contentKind ?? "photo") === "photo")
      .length ?? 0) > 1;
  const comic =
    (roots?.filter((root) => root.contentKind === "comic").length ?? 0) > 1;
  const setMultiRoot = useUIStore((s) => s.setMultiRoot);
  useEffect(() => {
    setMultiRoot({ photo, comic });
  }, [photo, comic, setMultiRoot]);
  return query;
}

// 应用常驻层统一同步阅读派生缓存；画廊和其他页面也会修改未打开列表的状态。
export function useLibraryActivitySync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      for (const queryKey of activityAffectedKeys()) {
        // 失效未挂载页面的缓存，但只立即重新获取当前有订阅的数据。
        void queryClient.invalidateQueries({ queryKey });
      }
    };
    window.addEventListener(ACTIVITY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACTIVITY_CHANGED_EVENT, refresh);
  }, [queryClient]);
}

// 当前模式的未读计数。未读只属于漫画工作台，照片侧恒为 0。
export function useLibraryActivitySummary() {
  const { mode, ready } = useAppMode();
  return useQuery({
    queryKey: libraryQueryKeys.activitySummary(mode),
    queryFn: ({ signal }) => libraryApi.activitySummary(mode, signal),
    staleTime: 30_000,
    enabled: ready,
  });
}

// 首页仪表盘包含有限未读预览和在读摘要；活动变更后立即刷新，避免进度卡滞后。
export function useLibraryDashboard() {
  const { mode, ready } = useAppMode();
  return useQuery({
    queryKey: libraryQueryKeys.dashboard(mode),
    queryFn: ({ signal }) => libraryApi.dashboard(mode, signal),
    staleTime: 30_000,
    enabled: ready,
  });
}

// 未读页直接取得服务端筛好的相册，不能先下载全库再批量查询每条阅读活动。
export function useLibraryUnreadAlbums(q = "", workId = "") {
  const { mode, ready } = useAppMode();
  return useInfiniteQuery({
    queryKey: [...libraryQueryKeys.unreadAlbums(mode), "volumes", q, workId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({signal,pageParam}) => libraryApi.unreadVolumePage(q,workId,pageParam,signal),
    getNextPageParam: last => last.page.nextCursor,
    select: data => ({...data.pages[0].page, items:data.pages.flatMap(p=>p.page.items)}),
    staleTime: 30_000,
    enabled: ready,
  });
}

export function useAlbumMedia(
  albumId: string,
  expectedRevision?: number,
  enabled = true,
  filter?: AlbumFilterQuery,
) {
  // 详情页只先取首屏媒体；调用方在虚拟网格接近末尾时继续取下一页。
  // 阅读器仍可使用 libraryApi.allMedia 一次性建立跨页导航上下文。
  //
  // 筛选条件进查询键：筛选与否是两份不同的数据，换筛选就是换一份缓存，
  // 旧的那份留着，切回去是秒开。
  return useInfiniteQuery({
    queryKey: [
      ...libraryQueryKeys.media(albumId, albumFilterKey(filter)),
      expectedRevision,
    ],
    queryFn: async ({ pageParam, signal }) => {
      const response = await libraryApi.mediaPage(
        albumId,
        pageParam,
        undefined,
        signal,
        filter,
      );
      const page = response.page;
      if (
        expectedRevision !== undefined &&
        page.revision !== expectedRevision
      ) {
        throw new LibraryRevisionChangedError();
      }
      return page;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: enabled && albumId.length > 0,
  });
}

/**
 * 这本相册里真实可用的筛选条件。
 *
 * 只有打开筛选面板时才去取：这份数据要读分析记录与人物索引，
 * 不该在每次进相册时都付这个代价。
 */
export function useAlbumFilters(albumId: string, enabled = true) {
  return useQuery({
    queryKey: libraryQueryKeys.albumFilters(albumId),
    queryFn: ({ signal }) => libraryApi.albumFilters(albumId, signal),
    enabled: enabled && albumId.length > 0,
    staleTime: 60_000,
  });
}

/** 筛选条件的缓存标记：同一套条件共用一份数据。 */
function albumFilterKey(filter?: AlbumFilterQuery): string {
  if (!filter) return "";
  const parts = [
    filter.from ?? "",
    filter.to ?? "",
    filter.personId ?? "",
    filter.adcode ?? "",
    filter.picks ?? "",
    filter.scene ?? "",
    filter.collapse ? "fold" : "",
    filter.expand ?? "",
  ];
  return parts.join("|");
}

export function useLibraryTags(enabled = true, expectedRevision?: number) {
  const { mode, ready } = useAppMode();
  return useQuery({
    queryKey: [...libraryQueryKeys.tags(mode), expectedRevision],
    queryFn: async ({ signal }) => {
      const page = await libraryApi.allTags(mode, signal);
      if (
        expectedRevision !== undefined &&
        page.revision !== expectedRevision
      ) {
        throw new LibraryRevisionChangedError();
      }
      return page;
    },
    enabled: enabled && ready,
  });
}

/**
 * 「最近加入」的相册摘要。
 *
 * 照片工作台不记录浏览进度，没有「继续阅读」可言；这个列表是它与
 * 漫画侧对称的入口，也是收藏空态的推荐来源。
 */
export function useLibraryRecentAlbums(
  kind: AppMode,
  limit = 12,
  enabled = true,
) {
  const { ready } = useAppMode();
  return useQuery({
    queryKey: [...libraryQueryKeys.mode(kind), "recent", limit],
    queryFn: ({ signal }) => libraryApi.recentAlbums(kind, limit, signal),
    enabled: ready && enabled,
    staleTime: 60_000,
  });
}

export function usePhotoMemories(date: string, enabled: boolean) {
  const { ready } = useAppMode();
  return useQuery({
    queryKey: [...libraryQueryKeys.mode("photo"), "photo-memories", date],
    queryFn: ({ signal }) => libraryApi.photoMemories(date, signal),
    enabled: ready && enabled,
    staleTime: 60 * 60 * 1000,
  });
}

export function useLibraryNodes(ids: string[]) {
  return useQuery({
    queryKey: libraryQueryKeys.nodes(ids),
    queryFn: ({ signal }) => libraryApi.queryNodes(ids, signal),
    enabled: ids.length > 0,
  });
}

/**
 * 某个节点的所有上级集合，从最外层到紧邻它的那一层。
 *
 * 集合页用它拼面包屑（存照 / 萍乡中学 / 3班running man）：页头里的
 * 「返回」只说得出「回去」，说得出「回到哪」的是祖先链。
 *
 * 一级一级往上问：节点摘要带 parentId，拿到上级才能知道再上一级是谁。
 * 目录层级很浅，请求数也就一两个。
 */
export function useLibraryAncestors(parentId: string) {
  return useQuery({
    queryKey: [...libraryQueryKeys.root, "ancestors", parentId],
    queryFn: async ({ signal }) => {
      const chain: LibraryNodeSummary[] = [];
      let current = parentId;
      while (current) {
        const result = await libraryApi.queryNodes([current], signal);
        const node = result.items[0];
        if (!node) break;
        chain.unshift(node);
        current = node.parentId ?? "";
      }
      return chain;
    },
    enabled: parentId.length > 0,
    staleTime: 60_000,
  });
}
