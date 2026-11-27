import { useUIStore } from "../store/uiStore";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { prefsApi, type HistoryEntry, type Prefs } from "../api/prefs";
import { historyQueryKey, prefsQueryKey } from "../api/queryKeys";

/**
 * 服务端偏好的查询选项。
 *
 * 设置页、侧栏、阅读器读的是同一份偏好：共用一个查询键，改动后几处同时
 * 刷新，不必各写一份 useQuery。
 */
export const prefsQueryOptions = {
  queryKey: prefsQueryKey,
  queryFn: () => prefsApi.get(),
};

/**
 * 服务端偏好（主题、自动切换下一本、侧栏折叠等）。
 */
export function usePrefs() {
  return useQuery<Prefs>(prefsQueryOptions);
}

export const prefsPatchKey = ["prefs-patch"] as const;

export function usePatchPrefs() {
  const qc = useQueryClient();
  const pushToast = useUIStore((state) => state.pushToast);
  const busy = useIsMutating({ mutationKey: prefsPatchKey }) > 0;
  const patchPrefs = useMutation({
    mutationKey: prefsPatchKey,
    mutationFn: (p: Partial<Parameters<typeof prefsApi.patch>[0]>) =>
      prefsApi.patch(p),
    onSuccess: (saved, patch) => {
      qc.setQueryData(prefsQueryOptions.queryKey, saved);
      if (patch.maxRecent !== undefined) {
        // 保留条数变了，最近访问要按新上限裁剪。服务端按同一口径裁（保留
        // 最新的若干条），客户端先照着裁一份写回缓存 —— 之后的读取失败
        // 也不该把已经裁掉的记录放回来。
        const limit = saved.maxRecent;
        qc.setQueryData<{ history: HistoryEntry[] }>(
          historyQueryKey,
          (previous) =>
            previous ? { history: previous.history.slice(0, limit) } : previous,
        );
        void qc.invalidateQueries({ queryKey: historyQueryKey });
      }
      void qc.invalidateQueries({ queryKey: prefsQueryOptions.queryKey });
    },
    onError: () => pushToast({ kind: "error", message: "保存阅读设置失败" }),
  });

  return { patchPrefs, busy };
}
