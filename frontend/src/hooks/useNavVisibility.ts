import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { prefsApi } from "../api/prefs";
import { DEFAULT_HIDDEN_NAV_ITEMS } from "../utils/navEntries";

export interface NavVisibility {
  /** 某个导航项当前是否显示在侧栏。 */
  isVisible: (key: string) => boolean;
  /** 生效的隐藏清单（服务端偏好里的同一份）。 */
  hidden: string[];
}

/**
 * 侧栏导航项的可见性。
 *
 * 真相源是服务端偏好：侧栏在哪台设备打开都是同一套菜单。偏好还没
 * 读回来时用前端默认清单兜底 —— 它与服务端的默认值一致，所以不会出现
 * 「先全显示、再收掉三项」的闪动。
 */
export function useNavVisibility(): NavVisibility {
  const query = useQuery({
    queryKey: ["prefs"],
    queryFn: () => prefsApi.get(),
    staleTime: 5 * 60 * 1000,
  });
  const hidden = query.data?.hiddenNavItems ?? DEFAULT_HIDDEN_NAV_ITEMS;
  return useMemo(() => {
    const set = new Set(hidden);
    return {
      hidden,
      isVisible: (key: string) => !set.has(key),
    };
  }, [hidden]);
}
