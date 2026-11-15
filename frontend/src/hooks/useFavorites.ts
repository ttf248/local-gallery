import { useCallback } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { favoritesApi } from "../api/prefs";
import { favoritesQueryKey } from "../api/queryKeys";

const EMPTY_FAVORITES: string[] = [];

/**
 * 收藏列表的查询选项。
 *
 * 收藏只有这一份缓存：卡片上的星标、收藏页的列表、批量操作的结果都写这里。
 */
export const favoritesQueryOptions = {
  queryKey: favoritesQueryKey,
  queryFn: () => favoritesApi.list(),
  staleTime: 30_000,
};

type FavoritesResponse = Awaited<ReturnType<typeof favoritesApi.list>>;

/**
 * 把服务端返回的收藏清单写回缓存，并在后台重新读一次。
 *
 * 写接口回的就是完整清单（服务端去重、裁剪后的结果），它比任何一次列表
 * 读取都新 —— 但后台那一次读取仍有价值：它确认服务端真的收下了这次写入，
 * 也顺带捡回别的入口（比如批量操作）改动的内容。
 *
 * 关键是要先中止还在飞的读取：它带着写入之前的快照，回来得晚就会把刚
 * 写进去的值盖回去 —— 连点两次星标就会出现「刚取消又亮回来」。
 */
function applyFavorites(qc: QueryClient, saved: FavoritesResponse) {
  void qc.cancelQueries({ queryKey: favoritesQueryOptions.queryKey });
  qc.setQueryData(favoritesQueryOptions.queryKey, saved);
  void qc.invalidateQueries({ queryKey: favoritesQueryOptions.queryKey });
}

// 收藏集合的全局 hook：list + toggle
export function useFavorites() {
  const qc = useQueryClient();

  const query = useQuery(favoritesQueryOptions);

  const updateFavorites = (saved: FavoritesResponse) => {
    applyFavorites(qc, saved);
  };

  const add = useMutation({
    mutationFn: (resourceId: string) => favoritesApi.add(resourceId),
    onSuccess: updateFavorites,
  });

  const remove = useMutation({
    mutationFn: (resourceId: string) => favoritesApi.remove(resourceId),
    onSuccess: updateFavorites,
  });

  const list = query.data?.favorites ?? EMPTY_FAVORITES;

  async function toggle(resourceId: string) {
    const current = await qc.ensureQueryData(favoritesQueryOptions);
    if (current.favorites.includes(resourceId)) {
      await remove.mutateAsync(resourceId);
    } else {
      await add.mutateAsync(resourceId);
    }
  }

  return {
    favorites: list,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: query.refetch,
    add: (resourceId: string) => add.mutateAsync(resourceId),
    remove: (resourceId: string) => remove.mutateAsync(resourceId),
    toggle,
  };
}

// 只写不订阅：卡片上的星标按钮用。
// 列表页可能有上百张卡片，每张都订阅收藏列表会让任意一次收藏写入触发全量重渲染，
// 所以这里直接按需读写缓存，不建立查询订阅。
export function useToggleFavorite() {
  const qc = useQueryClient();

  return useCallback(
    async (resourceId: string) => {
      const current = await qc.ensureQueryData(favoritesQueryOptions);
      const saved = current.favorites.includes(resourceId)
        ? await favoritesApi.remove(resourceId)
        : await favoritesApi.add(resourceId);
      applyFavorites(qc, saved);
    },
    [qc],
  );
}
