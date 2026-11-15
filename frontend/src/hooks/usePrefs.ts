import { useQuery } from "@tanstack/react-query";
import { prefsApi, type Prefs } from "../api/prefs";
import { prefsQueryKey } from "../api/queryKeys";

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
