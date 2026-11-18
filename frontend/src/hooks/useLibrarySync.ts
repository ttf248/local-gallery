import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  librarySyncApi,
  librarySyncQueryKey,
  type LibrarySyncPatch,
  type LibrarySyncStatus,
} from "../api/librarySync";
import { libraryQueryKeys } from "../api/queryKeys";

/** 轮询间隔：文件变化到图库更新之间本来就有一两秒的合并窗口。 */
const POLL_INTERVAL = 5000;

/**
 * 读取自动发现文件变化的状态。
 *
 * 设置页与界面其它地方共用这一份缓存：轮询由 TanStack Query 去重，
 * 挂在几处也不会多发请求。
 */
export function useLibrarySyncStatus() {
  return useQuery({
    queryKey: librarySyncQueryKey,
    queryFn: ({ signal }) => librarySyncApi.status(signal),
    refetchInterval: POLL_INTERVAL,
  });
}

/**
 * 修改自动发现文件变化的开关。
 *
 * 改完立刻把返回的状态写回缓存，界面不用等下一轮轮询。
 */
export function useUpdateLibrarySync() {
  const queryClient = useQueryClient();
  return async (patch: LibrarySyncPatch): Promise<LibrarySyncStatus | undefined> => {
    const status = await librarySyncApi.update(patch);
    queryClient.setQueryData(librarySyncQueryKey, status);
    return status;
  };
}

/**
 * 图库版本变化时让界面重新拉数据。
 *
 * 后端增量更新会发布新的图库版本；界面上已经打开的列表还停在旧数据上，
 * 这里监听版本号，一变就失效媒体库相关的查询。
 *
 * 只在版本真的变了才失效：轮询本身不该引起任何重新拉取。
 */
export function useLibraryRevisionSync() {
  const queryClient = useQueryClient();
  const query = useLibrarySyncStatus();
  const revision = query.data?.libraryRevision;
  const lastRevision = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (revision === undefined) return;
    if (lastRevision.current === undefined) {
      lastRevision.current = revision;
      return;
    }
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.root });
  }, [revision, queryClient]);
}
