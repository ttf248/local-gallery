import { useCallback, useMemo, useState } from "react";
import type { LibraryMediaItem } from "../api/library";
import type { PhotoViewerProps } from "../components/wall/PhotoViewer";

/**
 * 大图预览认的媒体项：墙上的项，外加「它出自哪本相册」。
 *
 * 跨相册的墙（年份、精选、人物、语义搜索）里的每一项都带着出处；
 * 相册内的墙里每一项出自同一本，序列本身不携带，由 albumId 补上。
 */
export type WallViewerItem = LibraryMediaItem & {
  albumId?: string;
  albumName?: string;
};

interface Options<T extends WallViewerItem> {
  /** 已加载的媒体项。 */
  items: T[];
  /**
   * 媒体总数。
   *
   * 墙是分页加载的：只报已加载的数量会与页头那个「403 张」对不上，
   * 同一本相册在两处报两个数，用户只会以为其中一个是错的。
   */
  total?: number;
  /** 标题说清这一张出自哪本相册。 */
  albumName: (item: T) => string;
  /** 标题点一下回到的那本相册。 */
  albumHref?: (item: T) => string | undefined;
  /** 这一串照片属于哪本相册（相册内的墙用同一本）。 */
  albumId?: string;
  /** 翻到已加载的末尾时自动接下一页。 */
  hasNextPage?: boolean;
  /** 正在取下一页。 */
  isLoadingMore?: boolean;
  /** 取下一页失败：已加载的内容仍可浏览，但要给一个重试的手柄。 */
  loadMoreError?: boolean;
  /** 取下一页。 */
  onLoadMore?: () => void;
  /** 这张照片是否在精选里。 */
  isPicked?: (id: string) => boolean;
  /** 把这张照片加入 / 移出精选。 */
  onTogglePick?: (item: T) => void;
}

export interface WallViewer {
  /** 当前查看的序号；没开预览（或那一项还没取到）时是 null。 */
  index: number | null;
  /** 正在看的那一项的资源 ID；关掉预览后是 null。 */
  openId: string | null;
  /** 关掉预览后墙要滚回的下标。 */
  focusIndex: number | null;
  /** 打开第 index 张。 */
  open: (index: number) => void;
  /** 按资源 ID 打开：有的地方先记住的是 ID（照片带要等分页取到那一段）。 */
  openById: (id: string) => void;
  /** 关掉预览：墙回到刚才看的那张。 */
  close: () => void;
  /** 直接关掉预览，不记「回到哪张」（换了一组内容时用）。 */
  reset: () => void;
  /** 交给 `<PhotoViewer {...viewer} />` 的属性；没开预览时是 null。 */
  viewer: PhotoViewerProps | null;
}

/**
 * 照片墙的大图预览：下标、翻页与「关掉后回到刚才那张」。
 *
 * 照片墙散在八个地方（相册、精选、年份、人物、语义搜索、地点、行程），
 * 每处的预览行为本该是同一件事：打开一张、左右翻、关掉后墙回到刚才
 * 看的那张。各自写一遍的结果是有的地方关掉预览后墙跳回顶上 ——
 * 翻了几百张再关掉，用户得自己滚回去找。
 *
 * 开着的是哪一张按资源 ID 记，下标由它算出来：分页取到新的一页时
 * 列表会变，按下标记的「当前看第几张」会漂到别的照片上。
 */
export function useWallViewer<T extends WallViewerItem>(
  options: Options<T>,
): WallViewer {
  const {
    items,
    total,
    albumName,
    albumHref,
    albumId,
    hasNextPage,
    isLoadingMore,
    loadMoreError,
    onLoadMore,
    isPicked,
    onTogglePick,
  } = options;

  const [openId, setOpenId] = useState<string | null>(null);
  // 关掉大图预览后回到刚才看的那张。
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  const index = useMemo(() => {
    if (openId === null) return null;
    const found = items.findIndex((item) => item.id === openId);
    return found >= 0 ? found : null;
  }, [items, openId]);

  const open = useCallback(
    (next: number) => {
      // 打开前先把「回到哪张」清掉：关掉预览时重新对一次位置，
      // 同一张照片看了又看也能滚回去。
      setFocusIndex(null);
      const item = items[next];
      setOpenId(item ? item.id : null);
    },
    [items],
  );

  const openById = useCallback((id: string) => {
    setFocusIndex(null);
    setOpenId(id);
  }, []);

  const close = useCallback(() => {
    setFocusIndex(index);
    setOpenId(null);
  }, [index]);

  const reset = useCallback(() => {
    setFocusIndex(null);
    setOpenId(null);
  }, []);

  const viewer = useMemo<PhotoViewerProps | null>(() => {
    if (index === null) return null;
    const item = items[index];
    // 条目不在了（翻页后集合变了）：不摆一个空预览给用户。
    if (!item) return null;
    return {
      items,
      index,
      albumName: albumName(item),
      albumHref: albumHref?.(item),
      albumId,
      totalCount: total ?? items.length,
      hasNextPage,
      isLoadingMore,
      loadMoreError,
      onLoadMore,
      onIndexChange: (next: number) => {
        const target = items[next];
        if (target) setOpenId(target.id);
      },
      onClose: close,
      isPicked: isPicked?.(item.id),
      onTogglePick: onTogglePick ? () => onTogglePick(item) : undefined,
    };
  }, [
    items,
    index,
    albumName,
    albumHref,
    albumId,
    total,
    hasNextPage,
    isLoadingMore,
    loadMoreError,
    onLoadMore,
    isPicked,
    onTogglePick,
    close,
  ]);

  return { index, openId, focusIndex, open, openById, close, reset, viewer };
}
