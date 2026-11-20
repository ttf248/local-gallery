import { useCallback, useEffect, useMemo } from "react";
import { useAlbumMedia } from "./useLibrary";
import { apiErrorMessage } from "../utils/apiError";

export type ReaderMediaStatus =
  | "no-album"
  | "loading"
  | "empty"
  | "error"
  | "ready";

export interface ReaderMedia {
  /** 图片资源 ID，按卷内顺序。 */
  images: string[];
  /**
   * 每页的原始像素尺寸（资源 ID → 宽高）。
   *
   * 连续模式按它预留高度：图片加载前先占好位置，页面不跳、页码不乱。
   */
  dimensions: Record<string, { width: number; height: number }>;
  /** 视频资源 ID，按卷内顺序。 */
  videos: string[];
  /** 相册里「另一种媒体」的数量：图片模式看视频数，视频模式看图片数。 */
  siblingCount: number;
  status: ReaderMediaStatus;
  /** 加载失败时的中文提示。 */
  error: string | null;
  /** 重新拉取这一卷的媒体清单。 */
  reload: () => void;
}

/**
 * 阅读器的媒体清单。
 *
 * 走的是与相册页同一份查询缓存（`useAlbumMedia`）：两边来回切不再把
 * 整本清单重下一遍。阅读器要的是整本，所以这里把剩下的页依次取完，
 * 取完之前状态仍是「加载中」—— 半本清单翻起来只会翻到一半。
 */
export function useReaderMedia(
  albumId: string,
  isVideo: boolean,
): ReaderMedia {
  const query = useAlbumMedia(albumId);
  const { data, error, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    query;

  // 取完最后一页为止。
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = useMemo(
    () => (data?.pages ?? []).flatMap((page) => page.items),
    [data],
  );
  const images = useMemo(
    () => items.filter((item) => item.kind === "image").map((item) => item.id),
    [items],
  );
  const videos = useMemo(
    () => items.filter((item) => item.kind === "video").map((item) => item.id),
    [items],
  );
  // 每一页的原始尺寸。服务端分析时量过，这里只是转个手。
  const dimensions = useMemo(() => {
    const map: Record<string, { width: number; height: number }> = {};
    for (const item of items) {
      if (item.kind !== "image") continue;
      if (!item.width || !item.height) continue;
      map[item.id] = { width: item.width, height: item.height };
    }
    return map;
  }, [items]);

  const complete = data !== undefined && !hasNextPage;
  const status: ReaderMediaStatus =
    albumId.length === 0
      ? "no-album"
      : error
        ? "error"
        : !complete
          ? "loading"
          : (isVideo ? videos : images).length === 0
            ? "empty"
            : "ready";

  const errorMessage = error
    ? apiErrorMessage(error, "无法读取媒体（网络或服务异常）")
    : null;

  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    images,
    videos,
    dimensions,
    siblingCount: isVideo ? images.length : videos.length,
    status,
    error: errorMessage,
    reload,
  };
}
