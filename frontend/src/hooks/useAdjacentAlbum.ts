import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { libraryApi } from "../api/library";
import {
  entryDisplayName,
  entryReaderUrl,
  getGalleryContext,
  setGalleryContext,
  type GalleryContextEntry,
} from "../utils/galleryContext";
import { albumRoute } from "../utils/path";
import { useGalleryStore } from "../store/galleryStore";
import { useUIStore } from "../store/uiStore";

/**
 * 在画廊上下文里找出相邻的一卷。
 *
 * 跳卷按钮与它悬停时显示的目标卷名用的是同一套查找 —— 两处各写一遍
 * 的话，按钮上的名字和实际跳去的卷迟早会对不上。
 *
 * 找不到阅读器入口的条目一律跳过：集合没有，照片相册也没有
 * （照片要进照片墙，把一卷照片丢进漫画阅读器是一次真实的错位）。
 */
export function resolveAdjacentEntry(
  ctx: ReturnType<typeof getGalleryContext>,
  pathParam: string | undefined,
  direction: 1 | -1,
  options: { albumsOnly: boolean; isVideo: boolean },
): { entry: GalleryContextEntry; index: number } | null {
  if (!ctx || ctx.list.length <= 1 || !pathParam) return null;
  const curIdx = ctx.list.findIndex((it) => it.key === pathParam);
  const base = curIdx >= 0 ? curIdx : ctx.index;
  const n = ctx.list.length;
  for (let step = 1; step <= n; step++) {
    const nextIdx = (((base + direction * step) % n) + n) % n;
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

export interface AdjacentAlbumOptions {
  /** 当前阅读的相册 ID。 */
  pathParam: string;
  /** 当前是不是视频模式（决定跳卷时数的是视频还是图片）。 */
  isVideo: boolean;
  /** 跳转前收尾：关掉信息面板等。 */
  onBeforeNavigate?: () => void;
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
}: AdjacentAlbumOptions) {
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);

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
      let ctx = getGalleryContext();
      try {
        // 前向到达已加载边界时继续取页；反向环绕需要找到真正的末尾。
        while (ctx?.pagination?.nextCursor) {
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
          if (
            (direction === 1 && remaining) ||
            (direction === -1 && current > 0)
          )
            break;
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
          setGalleryContext(ctx);
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
            message: "当前无可用的「上一卷 / 下一卷」列表",
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
      // 双页模式下把索引对齐到偶数（左页），跟手动翻页保持一致。
      const state = useGalleryStore.getState();
      state.setMode(state.mode);
      navigate(readerUrl, { replace: false });
      return true;
    },
    [pathParam, pushToast, navigate, isVideo, onBeforeNavigate],
  );

  // 跨卷导航按钮上的目标卷名。
  //
  // 光有两枚箭头，用户不知道点下去会翻到哪一卷 —— 名称在悬停时浮出，
  // 箭头本身仍然只是箭头，不抢画面的注意力。
  const adjacentNames = useMemo(() => {
    const ctx = getGalleryContext();
    const pick = (direction: 1 | -1) =>
      resolveAdjacentEntry(ctx, pathParam, direction, {
        albumsOnly: false,
        isVideo,
      })?.entry;
    const nameOf = (entry: GalleryContextEntry | undefined) =>
      entry ? entryDisplayName(entry) : "";
    return { prev: nameOf(pick(-1)), next: nameOf(pick(1)) };
  }, [pathParam, isVideo]);

  return { goAdjacent, adjacentNames };
}
