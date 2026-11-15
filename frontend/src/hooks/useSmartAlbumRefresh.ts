import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { sse } from "../api/client";
import { albumsApi } from "../api/albums";
import type {
  SmartAlbumRefreshProgress,
  SmartAlbumRefreshStatus,
} from "../api/albums";
import { useSmartAlbumRefreshStore } from "../store/smartAlbumRefreshStore";

const REFRESH_EVENTS: SmartAlbumRefreshStatus[] = [
  "pending",
  "running",
  "complete",
  "cancelled",
  "error",
];

function isRefreshProgress(value: unknown): value is SmartAlbumRefreshProgress {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SmartAlbumRefreshProgress>;
  return (
    typeof candidate.jobId === "string" && typeof candidate.status === "string"
  );
}

function isActive(status?: SmartAlbumRefreshStatus) {
  return status === "pending" || status === "running";
}

/**
 * 订阅智能相册刷新任务的进度。
 *
 * 连接的生命周期跟着 jobId 走，不跟着组件挂载走：任务中心被切走再切回来，
 * 刷新还在跑，进度不该断。jobId 存在共享 store 里，跨页面也接得上。
 */
export function useSmartAlbumRefresh() {
  const jobId = useSmartAlbumRefreshStore((s) => s.jobId);
  const progress = useSmartAlbumRefreshStore((s) => s.progress);
  const setProgress = useSmartAlbumRefreshStore((s) => s.setProgress);
  const setActive = useSmartAlbumRefreshStore((s) => s.setActive);
  const clear = useSmartAlbumRefreshStore((s) => s.clear);

  const closeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const close = sse(
      `/api/smart-albums/refresh/${encodeURIComponent(jobId)}/events`,
      (_name, data) => {
        if (!isRefreshProgress(data)) return;
        setProgress(data);
        if (!isActive(data.status)) {
          // 终态之后服务端会关闭连接；不主动关掉的话 EventSource
          // 会自己重连，反复订阅一个已经结束的任务。
          closeRef.current?.();
          closeRef.current = null;
        }
      },
      { events: REFRESH_EVENTS },
    );
    closeRef.current = close;
    return () => {
      close();
      closeRef.current = null;
    };
  }, [jobId, setProgress]);

  // 服务端当前的任务：刷新页面或换设备回来后，进度要接得上。
  const activeQuery = useQuery({
    queryKey: ["smart-album-refresh-active"],
    queryFn: ({ signal }) => albumsApi.smartAlbumRefreshActive(signal),
    retry: false,
    staleTime: 5_000,
  });

  useEffect(() => {
    const task = activeQuery.data?.task;
    if (!task) return;
    const store = useSmartAlbumRefreshStore.getState();
    if (store.jobId !== task.jobId) {
      store.setActive(task.jobId);
      store.setProgress(task);
      return;
    }
    if (store.progress !== task) store.setProgress(task);
  }, [activeQuery.data]);

  const running = isActive(progress?.status);

  return {
    jobId,
    progress,
    isRunning: running,
    isComplete: progress?.status === "complete",
    isCancelled: progress?.status === "cancelled",
    isError: progress?.status === "error",
    start: (id: string) => setActive(id),
    reset: clear,
  };
}
