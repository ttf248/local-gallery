import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { prefsQueryOptions, usePatchPrefs } from "../../hooks/usePrefs";
import { favoritesApi, historyApi } from "../../api/prefs";
import { favoritesQueryKey, libraryQueryKeys } from "../../api/queryKeys";
import { scanApi } from "../../api/scan";
import { useUIStore } from "../../store/uiStore";
import { syncHistoryCache } from "../../utils/historyCache";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { buttonStyles } from "../../ui/buttonStyles";
import { LibraryIcon } from "../../ui/icons";
import { SettingsGroup, SettingsRow } from "../../ui/SettingsList";
import { StorageSection } from "../tasks";
import LibraryIndexCard from "./LibraryIndexCard";
import AutoSyncPanel from "./AutoSyncPanel";
import StateBackupPanel from "./StateBackupPanel";

export default function DataStorageTab({ active }: { active: boolean }) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const prefsQuery = useQuery({ ...prefsQueryOptions, enabled: active });
  const { data } = prefsQuery;
  const { patchPrefs, busy } = usePatchPrefs();
  const [clearTarget, setClearTarget] = useState<"index" | "history" | null>(
    null,
  );
  useEffect(() => {
    if (!active) setClearTarget(null);
  }, [active]);
  const pruneFav = useMutation({
    mutationFn: () => favoritesApi.prune(),
    onSuccess: (r) => {
      const removed = new Set(r.removed);
      const keep = (id: string) => !removed.has(id);
      qc.setQueryData<Awaited<ReturnType<typeof favoritesApi.list>>>(
        favoritesQueryKey,
        (previous) =>
          previous ? { favorites: previous.favorites.filter(keep) } : undefined,
      );
      void qc.invalidateQueries({ queryKey: favoritesQueryKey });
      pushToast({
        kind: "success",
        message: `已清理 ${r.removed.length} 项失效收藏`,
      });
    },
    onError: () => pushToast({ kind: "error", message: "清理失效收藏失败" }),
  });

  // 清空媒体库索引。不同于「重新扫描」(会立即起一次新扫描覆盖旧结果),
  // 这里只把索引丢掉,等用户手动点「重新扫描」——避免误清后立刻被一次
  // 长任务占住 UI、掩盖问题。
  const clearScanCache = useMutation({
    mutationFn: () => scanApi.clearCache(),
    onSuccess: () => {
      // 丢弃所有摘要页，避免旧媒体根数据在下一次扫描前短暂回显。
      qc.removeQueries({ queryKey: libraryQueryKeys.root });
      pushToast({
        kind: "success",
        message: "已清空媒体库索引 · 建议点击「重新扫描」重建",
      });
    },
    onError: () => pushToast({ kind: "error", message: "清空媒体库索引失败" }),
  });

  const clearHist = useMutation({
    mutationFn: () => historyApi.clear(),
    onSuccess: () => {
      syncHistoryCache(qc, []);
      pushToast({ kind: "success", message: "已清空最近访问" });
    },
    onError: () => pushToast({ kind: "error", message: "清空最近访问失败" }),
  });

  return (
    <div className="space-y-5">
      <StorageSection
        overview={<LibraryIndexCard />}
        maintenance={<AutoSyncPanel />}
        records={
          <>
            <SettingsGroup id="records" title="收藏与最近访问">
              <div className="settings-rows flex flex-col">
                <SettingsRow label="最近访问保留条数">
                  {data ? (
                    <NumberInput
                      value={data.maxRecent}
                      disabled={busy || prefsQuery.isError}
                      min={1}
                      max={50}
                      onChange={(v) => patchPrefs.mutate({ maxRecent: v })}
                    />
                  ) : (
                    <span className="text-caption text-ink-2">
                      偏好尚未加载
                    </span>
                  )}
                </SettingsRow>
                <SettingsRow label="清理失效收藏">
                  <button
                    onClick={() => pruneFav.mutate()}
                    disabled={pruneFav.isPending}
                    className={buttonStyles({
                      variant: "secondary",
                      size: "sm",
                    })}
                  >
                    {pruneFav.isPending ? "清理中…" : "清理"}
                  </button>
                </SettingsRow>
              </div>
            </SettingsGroup>
            <SettingsGroup
              id="backup"
              title="备份与恢复"
              icon={<LibraryIcon size={13} />}
            >
              <StateBackupPanel />
            </SettingsGroup>
          </>
        }
      />
      <SettingsGroup
        id="danger"
        title="危险操作"
        description="清空的数据无法撤销。"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <SettingsRow
            danger
            label="清空媒体库索引"
            description="丢掉已经扫出来的相册与标签索引，下次扫描时重新建立。"
          >
            <Button
              variant="danger"
              disabled={clearScanCache.isPending}
              onClick={() => setClearTarget("index")}
            >
              清空索引
            </Button>
          </SettingsRow>
          <SettingsRow
            danger
            label="清空最近访问"
            description="丢掉最近浏览过的相册记录，保留收藏与精选。"
          >
            <Button
              variant="danger"
              disabled={clearHist.isPending}
              onClick={() => setClearTarget("history")}
            >
              清空
            </Button>
          </SettingsRow>
        </div>
      </SettingsGroup>
      <Dialog
        initialFocus={cancelButton}
        open={clearTarget !== null && active}
        title={clearTarget === "index" ? "清空媒体库索引？" : "清空最近访问？"}
        description="此操作无法撤销，不会修改原始文件。"
        onClose={() => setClearTarget(null)}
        size="sm"
        footer={
          <>
            <Button ref={cancelButton} onClick={() => setClearTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (clearTarget === "index") clearScanCache.mutate();
                if (clearTarget === "history") clearHist.mutate();
                setClearTarget(null);
              }}
            >
              确认清空
            </Button>
          </>
        }
      />
    </div>
  );
}

function NumberInput({
  value,
  disabled,
  min,
  max,
  onChange,
}: {
  value: number;
  disabled: boolean;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="inline-flex items-center border border-line rounded-md overflow-hidden">
      <button
        aria-label="减少最近访问保留条数"
        disabled={disabled}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-8 h-8 touch:min-w-10 touch:min-h-10 text-ink-2 hover:bg-sunken hover:text-ink transition-colors disabled:opacity-50"
      >
        −
      </button>
      <span className="px-3 h-8 inline-flex items-center text-body tabular-nums min-w-[40px] justify-center">
        {value}
      </span>
      <button
        aria-label="增加最近访问保留条数"
        disabled={disabled}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-8 h-8 touch:min-w-10 touch:min-h-10 text-ink-2 hover:bg-sunken hover:text-ink transition-colors disabled:opacity-50"
      >
        +
      </button>
    </div>
  );
}
