import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { progressApi, type ReadingProgress } from "../api/prefs";

const PROGRESS_BATCH_SIZE = 1_000;

// 单条进度查询：给 Album 详情页用。
export function useReadingProgress(albumId: string | null | undefined) {
  return useQuery({
    queryKey: ["progress", albumId],
    queryFn: async () => {
      if (!albumId) return null;
      try {
        return await progressApi.get(albumId);
      } catch {
        return null;
      }
    },
    enabled: !!albumId,
    staleTime: 30 * 1000,
  });
}

// 批量进度查询：给 Home/Recents/Favorites 列表用。
// 一次 POST /api/progress/batch 拿全部，避免 N 路并发 GET。
//
// 排序并去重后作为 queryKey，保证相同 ID 集合复用缓存；分块请求避免超出
// 后端单次 10,000 条限制，也限制单个请求体积。
export function useAllProgress(albumIds: string[], enabled = true) {
  const canonicalAlbumIds = useMemo(() => {
    return Array.from(new Set(albumIds)).sort();
  }, [albumIds]);

  return useQuery({
    queryKey: ["progress-batch", canonicalAlbumIds],
    queryFn: async () => {
      const chunks: string[][] = [];
      for (
        let offset = 0;
        offset < canonicalAlbumIds.length;
        offset += PROGRESS_BATCH_SIZE
      ) {
        chunks.push(
          canonicalAlbumIds.slice(offset, offset + PROGRESS_BATCH_SIZE),
        );
      }
      const responses = await Promise.all(
        chunks.map((chunk) => progressApi.batch(chunk)),
      );
      return responses.reduce<Record<string, ReadingProgress>>(
        (all, response) => {
          Object.assign(all, response.progress);
          return all;
        },
        {},
      );
    },
    enabled: enabled && canonicalAlbumIds.length > 0,
    staleTime: 30 * 1000,
  });
}

// 「继续阅读」单本删除：进度用 key=['progress', albumId]，批量用 ['progress-batch', ...]，
// 还有 Recents/Favorites 里 per-album 详情也用 ['progress', albumId]，
// invalidate 这三组足以让所有视图同步。
export function useDeleteProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (albumId: string) => progressApi.delete(albumId),
    onSuccess: (_data, albumId) => {
      qc.invalidateQueries({ queryKey: ["progress-batch"] });
      qc.invalidateQueries({ queryKey: ["progress", albumId] });
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}

// 「继续阅读」一键清空：所有 albumId 都失效。invalidateQueries 不带 predicate
// 会匹配 ['progress-batch', ...] / ['progress', albumId] / ['progress'] 全部。
export function useClearAllProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => progressApi.clearAll(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["progress-batch"] });
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}

// 「未读」单本标记已读：把 0-based progress.index 推到最后一页 total - 1。
// 首页「未读」hero 的 X 按钮和 AlbumCard 右键菜单的「标记为已读」都走这个。
// 复用 progressApi.set 而非 progressApi.delete 的考虑：
//   - 「未读」的语义是没有 progress 记录，最干净的"读完"是把 index 推到最后一页，
//     这样未来 Recents / Favorites / Album 详情里也能看到"看完了"的轨迹；
//   - 完全删除 progress 记录会丢失历史，跟右键「标记为已读」行为不一致。
//   失效范围与 useDeleteProgress 一致（progress-batch + progress）。
export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ albumId, total }: { albumId: string; total: number }) =>
      progressApi.set(albumId, Math.max(0, total - 1), total, 0),
    onSuccess: (_data, { albumId }) => {
      qc.invalidateQueries({ queryKey: ["progress-batch"] });
      qc.invalidateQueries({ queryKey: ["progress", albumId] });
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}

// 「未读」一键全部标记已读：单请求、单次原子落盘。
export function useMarkAllAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: { albumId: string; total: number }[]) => {
      const result = await progressApi.setBatch(
        items.map((item) => ({
          albumId: item.albumId,
          index: Math.max(0, item.total - 1),
          total: item.total,
          scroll: 0,
        })),
      );
      return { ok: result.updated, failed: 0, total: items.length };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["progress-batch"] });
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}
