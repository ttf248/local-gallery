import type { QueryClient } from "@tanstack/react-query";
import { type HistoryEntry } from "../api/prefs";
import { historyQueryKey, isViewedListQueryKey } from "../api/queryKeys";

/**
 * 写入已确认的历史快照，再刷新，避免读取失败时回显操作前的列表。
 *
 * 最近访问只有这一份缓存：历史不再跟着偏好另存一份。
 */
export function syncHistoryCache(
  client: QueryClient,
  history: HistoryEntry[],
) {
  client.setQueryData(historyQueryKey, { history });
  void client.invalidateQueries({ queryKey: historyQueryKey });
  // 「按最近看」排序的目录列表也要跟着变：它的排序依据就是打开时间。
  //
  // 认的是键的形状，不是把键序列化成字符串再搜 —— 后者一旦某个字段值里
  // 凑巧出现同样的字就会误伤。
  void client.invalidateQueries({
    predicate: (query) => isViewedListQueryKey(query.queryKey),
  });
}
