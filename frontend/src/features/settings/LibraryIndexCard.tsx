import { useMutation, useQueryClient } from "@tanstack/react-query";
import { scanApi } from "../../api/scan";
import { libraryQueryKeys } from "../../api/queryKeys";
import { useScanSSE } from "../../hooks/useScanSSE";
import { useLibraryManifest } from "../../hooks/useLibrary";
import { useUIStore } from "../../store/uiStore";
import { SettingsGroup } from "../../ui/SettingsList";
import { buttonStyles } from "../../ui/buttonStyles";
import { LibraryIcon, RefreshIcon } from "../../ui/icons";
import { ScanWarnings } from "../common";

export default function LibraryIndexCard({
  className,
}: {
  className?: string;
}) {
  const qc = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const manifest = useLibraryManifest().data?.manifest;
  const sse = useScanSSE();
  const startScan = useMutation({
    mutationFn: () => scanApi.start(),
    onSuccess: (r) => {
      sse.startWith(r.scanId);
      pushToast({ kind: "info", message: "扫描已开始" });
    },
    onError: () => pushToast({ kind: "error", message: "启动扫描失败" }),
  });
  return (
    <SettingsGroup
      id="library-index"
      className={className}
      title="媒体库索引"
      icon={<LibraryIcon size={13} />}
      description="索引与本机记录：这里动的是「已经扫出来的东西」，不会碰原始照片。"
    >
      {/* 索引这一项内容多：统计与动作挤在一行会读不清，
                  改成标题在上、内容在下的一整块。 */}
      <div id="data" className="settings-block py-3 px-0">
        <div>
          <span className="block mt-0.5 text-caption text-ink-2">
            {manifest
              ? `${manifest.statistics.albumCount} 本相册 · ${manifest.statistics.tagCount} 个标签${
                  manifest.scannedAt
                    ? ` · ${new Date(manifest.scannedAt).toLocaleString("zh-CN", { hour12: false })}`
                    : " · 尚未扫描"
                }`
              : "尚未加载"}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() =>
              void qc.invalidateQueries({
                queryKey: libraryQueryKeys.root,
              })
            }
            className={buttonStyles({ variant: "secondary", size: "sm" })}
          >
            <RefreshIcon size={11} />
            <span>刷新</span>
          </button>
          <button
            onClick={() => startScan.mutate()}
            disabled={startScan.isPending || sse.isRunning}
            className={buttonStyles({ variant: "secondary", size: "sm" })}
            title="扫描 (Ctrl+S)"
          >
            <RefreshIcon size={11} />
            <span>
              {sse.isRunning
                ? "扫描中…"
                : startScan.isPending
                  ? "启动中…"
                  : "重新扫描"}
            </span>
          </button>
        </div>
        {manifest && (
          <div className="mt-2">
            <ScanWarnings
              warnings={manifest.warnings}
              total={manifest.statistics.warningCount}
            />
          </div>
        )}
      </div>
    </SettingsGroup>
  );
}
