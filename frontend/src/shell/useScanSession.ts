import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUIStore } from "../store/uiStore";
import { useScanSSE } from "../hooks/useScanSSE";
import { scanApi } from "../api/scan";
import { libraryApi, type AppMode } from "../api/library";
import { libraryQueryKeys } from "../api/queryKeys";
export function useScanSession(mode: AppMode) {
  const pushToast = useUIStore((s) => s.pushToast);
  const [isCancellingScan, setIsCancellingScan] = useState(false);
  const cancelPending = useRef(false);
  const scanSse = useScanSSE();
  const queryClient = useQueryClient();
  const startScan = useMutation({
    mutationFn: () => scanApi.start(),
    onSuccess: ({ scanId }) => {
      scanSse.startWith(scanId);
      pushToast({ kind: "info", message: "扫描已开始" });
    },
    onError: () => pushToast({ kind: "error", message: "启动扫描失败" }),
  });

  useEffect(() => {
    if (!scanSse.isComplete || !scanSse.scanId) return;
    void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.root });
    void queryClient
      .fetchQuery({
        queryKey: libraryQueryKeys.manifest(),
        queryFn: () => libraryApi.manifest(),
      })
      .then(({ manifest }) => {
        pushToast({
          kind: "success",
          message: `扫描完成 · 共 ${manifest.statistics.albumCount} ${mode === "comic" ? "卷" : "本相册"}`,
        });
      })
      .catch(() => pushToast({ kind: "error", message: "刷新媒体库失败" }));
  }, [queryClient, scanSse.isComplete, scanSse.scanId, pushToast, mode]);

  const cancelScan = useCallback(async () => {
    if (!scanSse.scanId || cancelPending.current) return;

    cancelPending.current = true;
    setIsCancellingScan(true);
    try {
      await scanApi.cancel(scanSse.scanId);
      pushToast({ kind: "info", message: "已请求取消扫描" });
    } catch {
      pushToast({ kind: "error", message: "取消扫描失败，请稍后重试" });
    } finally {
      cancelPending.current = false;
      setIsCancellingScan(false);
    }
  }, [pushToast, scanSse.scanId]);

  const canStart = !startScan.isPending && !scanSse.isRunning;
  return {
    sse: scanSse,
    start: () => {
      if (canStart) startScan.mutate();
    },
    cancel: cancelScan,
    isCancelling: isCancellingScan,
    canStart,
  };
}
