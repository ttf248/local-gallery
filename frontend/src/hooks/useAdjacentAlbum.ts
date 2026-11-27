import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { libraryApi } from "../api/library";
import {
  entryDisplayName,
  entryReaderUrl,
  getGalleryContext,
  setGalleryContext,
  type GalleryContextEntry,
} from "../utils/galleryContext";
import { albumRoute } from "../utils/path";

import { useUIStore } from "../store/uiStore";

/**
 * 在画廊上下文里找出相邻的一卷。
 *
 * 跳卷按钮与它悬停时显示的目标卷名用的是同一套查找 —— 两处各写一遍
 * 的话，按钮上的名字和实际跳去的卷迟早会对不上。
 *
 * 找不到阅读器入口的条目一律跳过：集合没有，照片相册也没有
 * （照片要进照片墙，把一卷照片丢进漫画阅读器是一次真实的错位）。
 *
 * **不环绕**：读到最后一卷时没有「下一卷」，这一卷的前一卷也不会是
 * 列表里的第一卷。环绕会让「读完自动切下一卷」在最后一卷把读者甩回
 * 开头，读起来像跳错了一本。
 */
export function resolveAdjacentEntry(
  ctx: ReturnType<typeof getGalleryContext>,
  pathParam: string | undefined,
  direction: 1 | -1,
  options: { albumsOnly: boolean; isVideo: boolean },
): { entry: GalleryContextEntry; index: number } | null {
  if (!ctx || ctx.list.length <= 1 || !pathParam) return null;
  const curIdx = ctx.list.findIndex((it) => it.key === pathParam);
  // 当前这一卷不在这份列表里：无从判断上一卷 / 下一卷是谁。
  // 拿列表的第一项当锚点乱跳，比没有导航更糟。
  if (curIdx < 0) return null;
  const n = ctx.list.length;
  for (let step = 1; step <= n; step++) {
    const nextIdx = curIdx + direction * step;
    // 走出列表两端就是没有下一卷 / 上一卷。
    if (nextIdx < 0 || nextIdx >= n) return null;
    const nextEntry: GalleryContextEntry | undefined = ctx.list[nextIdx];
    if (!nextEntry) continue;
    if (!entryReaderUrl(nextEntry)) continue;
    if (options.albumsOnly) {
      // 跳到没有可读媒体的相册没有意义：图片模式跳进纯视频相册只会
      // 看到「没有图片」。数量未知（undefined）时不跳过。
      const count = options.isVideo
        ? nextEntry.videoCount
        : nextEntry.imageCount;
      if (count === 0) continue;
    }
    return { entry: nextEntry, index: nextIdx };
  }
  return null;
}

/**
 * 同一作品里的兄弟卷（当前这一卷的同层目录）。
 *
 * 跨卷导航的兜底：从首页「继续阅读」进来说卷时，上一次写进上下文的
 * 未必是这一份作品；作品里的卷就是那一段最自然的连续阅读顺序。
 */
export function useSiblingVolumes(
  parentId: string | undefined,
): GalleryContextEntry[] {
  const query = useQuery({
    queryKey: ["library", "children", parentId ?? "", "comic"],
    queryFn: ({ signal }) =>
      libraryApi.childrenAll(parentId ?? "", "comic", signal),
    enabled: Boolean(parentId),
    staleTime: 60_000,
  });
  return useMemo(
    () =>
      (query.data ?? [])
        .filter((node) => node.kind === "album")
        .map((node) => ({
          key: node.id,
          to: albumRoute(node.contentKind, node.id),
          name: node.name,
          parentName: node.parentName,
          kind: "album" as const,
          imageCount: node.imageCount,
          videoCount: node.videoCount,
          contentKind: node.contentKind,
        })),
    [query.data],
  );
}

export interface AdjacentAlbumOptions {
  /** 当前阅读的相册 ID。 */
  pathParam: string;
  /** 当前是不是视频模式（决定跳卷时数的是视频还是图片）。 */
  isVideo: boolean;
  /** 跳转前收尾：关掉信息面板等。 */
  onBeforeNavigate?: () => void;
  /**
   * 同一作品里的兄弟卷，作为跨卷导航的兜底。
   *
   * 上下文记的是「用户从哪个列表点进来的」。从首页「继续阅读」进来说卷
   * 时，上一次写进上下文的可能是另一页列表 —— 那一页里没有这一卷，
   * 跨卷导航就没有落脚点。这里给出同一部作品里的卷，跨卷导航至少
   * 能在作品内部接得上。
   */
  fallbackEntries?: GalleryContextEntry[];
}

/**
 * 挑一份能用的上下文：当前这一卷在列表里就用它，不在就用兜底。
 *
 * 两份都不是（当前卷既不在上下文里，也没有兄弟卷）时返回 null ——
 * 「没有上一卷 / 下一卷」是一句实话，比指一个不相干的卷好。
 */
function pickContext(
  pathParam: string,
  fallbackEntries: GalleryContextEntry[] | undefined,
): ReturnType<typeof getGalleryContext> {
  const ctx = getGalleryContext();
  if (ctx && ctx.list.some((entry) => entry.key === pathParam)) return ctx;
  // 兜底：同一作品里的卷。上下文可能压根没有（深链直接打开阅读器），
  // 也可能是另一页列表 —— 两种情况下兄弟卷都是最自然的落脚点。
  if (!fallbackEntries || fallbackEntries.length <= 1) return null;
  const index = fallbackEntries.findIndex((entry) => entry.key === pathParam);
  if (index < 0) return null;
  return {
    source: ctx?.source ?? { type: "direct" },
    list: fallbackEntries,
    index,
    openedAt: ctx?.openedAt ?? Date.now(),
    // 兜底列表是完整的（作品里的卷一次取全），没有可继续翻的页。
    pagination: undefined,
  };
}

/**
 * 跨卷导航（上一卷 / 下一卷）。
 *
 * - 相册继续在阅读器里读（不必回到相册首页再点「开始浏览」）；
 *   集合没有阅读器入口，回到它的首页。
 * - notify=false 时不弹「下一卷：xxx」提示（跟随「切换时显示通知」设置）。
 * - albumsOnly=true 时跳过集合，只找相册（自动切换下一卷用）。
 */
export function useAdjacentAlbum({
  pathParam,
  isVideo,
  onBeforeNavigate,
  fallbackEntries,
}: AdjacentAlbumOptions) {
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);

  const [loaded, setLoaded] = useState<{
    path: string;
    context: NonNullable<ReturnType<typeof pickContext>>;
  } | null>(null);
  const adjacentPending = useRef(false);
  const adjacentController = useRef<AbortController>();
  useEffect(() => () => adjacentController.current?.abort(), [pathParam]);

  const goAdjacent = useCallback(
    async (
      direction: 1 | -1,
      options?: { notify?: boolean; albumsOnly?: boolean },
    ) => {
      const notify = options?.notify ?? true;
      const albumsOnly = options?.albumsOnly ?? false;
      if (adjacentPending.current) return false;
      adjacentPending.current = true;
      const controller = new AbortController();
      adjacentController.current = controller;
      let ctx = pickContext(pathParam, fallbackEntries);
      try {
        // 前向到达已加载边界时继续取页；反向环绕需要找到真正的末尾。
        while (direction === 1 && ctx?.pagination?.nextCursor) {
          const current = ctx.list.findIndex(
            (entry) => entry.key === pathParam,
          );
          const remaining = ctx.list
            .slice(current + 1)
            .some(
              (entry) =>
                entryReaderUrl(entry) &&
                (!albumsOnly ||
                  (isVideo ? entry.videoCount : entry.imageCount) !== 0),
            );
          if (remaining) break;
          const page = await libraryApi.overview(
            ctx.pagination.query,
            ctx.pagination.nextCursor,
            controller.signal,
          );
          const entries = page.page.items.flatMap((item) =>
            item.kind !== "album"
              ? []
              : [
                  {
                    key: item.node.id,
                    to: albumRoute(item.node.contentKind, item.node.id),
                    name: item.node.name,
                    parentName: item.node.parentName,
                    imageCount: item.node.imageCount ?? 0,
                    videoCount: item.node.videoCount ?? 0,
                    contentKind: item.node.contentKind,
                  },
                ],
          );
          ctx = {
            ...ctx,
            list: [...ctx.list, ...entries],
            pagination: { ...ctx.pagination, nextCursor: page.page.nextCursor },
          };
          if (controller.signal.aborted) return false;
          setGalleryContext(ctx);
          setLoaded({ path: pathParam, context: ctx });
        }
      } catch {
        if (controller.signal.aborted) return false;
        pushToast({
          kind: "error",
          message: "无法加载下一批相册，请返回列表刷新后重试",
        });
        return false;
      } finally {
        adjacentPending.current = false;
      }
      if (controller.signal.aborted) return false;
      const found = resolveAdjacentEntry(ctx, pathParam, direction, {
        albumsOnly,
        isVideo,
      });
      if (!found) {
        if (notify) {
          pushToast({
            kind: "info",
            message:
              direction === 1
                ? "没有下一卷了，这一卷是这一部的最后一卷"
                : "没有上一卷了，这一卷是这一部的第一卷",
            ttl: 1500,
          });
        }
        return false;
      }
      const { entry: nextEntry, index: nextIdx } = found;
      const readerUrl = entryReaderUrl(nextEntry);
      if (!readerUrl) return false;
      const dirLabel = direction === 1 ? "下一卷" : "上一卷";
      if (notify) {
        pushToast({
          kind: "info",
          message: `${dirLabel}：${entryDisplayName(nextEntry)}`,
          ttl: 1200,
        });
      }
      try {
        sessionStorage.setItem(
          "local-gallery-context",
          JSON.stringify({
            ...ctx,
            index: nextIdx,
            openedAt: Date.now(),
          }),
        );
      } catch {
        // ignore
      }
      onBeforeNavigate?.();
      navigate(readerUrl, { replace: false });
      return true;
    },
    [
      pathParam,
      pushToast,
      navigate,
      isVideo,
      onBeforeNavigate,
      fallbackEntries,
    ],
  );

  // 跨卷导航按钮上的目标卷名。
  //
  // 光有两枚箭头，用户不知道点下去会翻到哪一卷 —— 名称在悬停时浮出，
  // 箭头本身仍然只是箭头，不抢画面的注意力。
  const adjacentNames = useMemo(() => {
    const ctx =
      loaded?.path === pathParam
        ? loaded.context
        : pickContext(pathParam, fallbackEntries);
    const pick = (direction: 1 | -1) =>
      resolveAdjacentEntry(ctx, pathParam, direction, {
        albumsOnly: true,
        isVideo,
      })?.entry;
    const nameOf = (entry: GalleryContextEntry | undefined) =>
      entry ? entryDisplayName(entry) : "";
    return {
      prev: nameOf(pick(-1)),
      next: nameOf(pick(1)),
      more: Boolean(ctx?.pagination?.nextCursor),
    };
  }, [pathParam, isVideo, fallbackEntries, loaded]);

  return { goAdjacent, adjacentNames };
}
