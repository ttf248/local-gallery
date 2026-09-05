import { useMemo } from "react";
import { useImageActivities } from "./useImageActivity";
import { useFavorites } from "./useFavorites";
import type { CardData } from "../components/album/AlbumGrid";
import type { ImageActivity } from "../api/activity";
import { asProgressLike, isUnread } from "../utils/progress";
import { useLibraryAlbums } from "./useLibrary";
import { nodeSummaryToCard } from "../utils/libraryCard";

// useUnreadAlbums 给出当前未读(还没看 / 刚打开)的所有相册,按需携带
// 收藏状态。返回值与 AlbumGrid 直接对接。
//
// 「未读」语义集中在 utils/progress.isUnread：没有图片活动才算未读；
// 一旦打开第 0 页即是在读，到达 pageCount - 1 后是已完成。
//
// 调用方拿到 cards 后可自由 sort / filter(各 page 行为不同)。
//
// 设计要点:
//  1. 仅依赖轻量相册摘要 + progress + favorites;不另起 SSE。
//  2. progress 拿全库 → 后续 Recents/Favorites 也想复用时可单独抽 store;
//     这里不抢公共状态,避免「A 改了 unread list,B 的 progress 也被刷」这种
//     隐式耦合。
//  3. 收藏状态在 cards 阶段就合并,调用方不用再处理 (path → fav) 映射。
interface UseUnreadAlbumsOptions {
  progressMap?: Record<string, ImageActivity>;
  loadProgress?: boolean;
}

export function useUnreadAlbums(options: UseUnreadAlbumsOptions = {}): {
  cards: CardData[];
  count: number;
  total: number;
  isLoading: boolean;
} {
  const { favorites } = useFavorites();
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const albumsQuery = useLibraryAlbums();
  const albums = useMemo(
    () => albumsQuery.data?.items ?? [],
    [albumsQuery.data],
  );

  // 批量拿全库的图片活动。只发当前库里的相册 ID，避免传一堆
  // 已被 prune 掉的旧 ID(后端 batch 会跳过不存在的 key,但前端少发点
  // payload 也好)。
  const albumIds = useMemo(() => albums.map((album) => album.id), [albums]);

  const progressQuery = useImageActivities(
    albumIds,
    options.loadProgress ?? true,
  );
  const progressMap = options.progressMap ?? progressQuery.data;

  const cards = useMemo<CardData[]>(() => {
    const out: CardData[] = [];
    for (const album of albums) {
      const p = progressMap?.[album.id];
      // 跟 utils/progress.isInProgress 互斥:这里「未读」= 既不在读、也非已读完
      // (实际就是 isUnread 的反义,但 isUnread 也把「total=0 空相册」算进去 —
      //  空相册不丢,继续按未读展示)。
      const imageCount = album.imageCount ?? 0;
      const isFresh = isUnread(asProgressLike(p, imageCount));
      if (!isFresh) continue;
      // 即便是 isFresh(还没读)也把 progress 字段填上 — AlbumCard 用它
      // 决定「标记为已读」菜单项是否可点。未读卡片要能右键直接标已读,
      // 没有 progress 字段就弹不出菜单，因此图片相册用当前图片数构造
      // 可标记状态。视频数量绝不能混入图片 pageCount；纯视频相册不
      // 构造伪图片页，播放位置仍由独立的视频活动保存。
      const total = imageCount;
      out.push({
        ...nodeSummaryToCard(album, "u:"),
        isFavorite: favSet.has(album.id),
        progress: { index: 0, total },
      });
    }
    return out;
  }, [albums, progressMap, favSet]);

  return {
    cards,
    count: cards.length,
    total: albums.length,
    isLoading:
      (albumsQuery.isLoading ||
        (options.loadProgress === false
          ? options.progressMap === undefined
          : progressQuery.isLoading)) &&
      cards.length === 0,
  };
}
