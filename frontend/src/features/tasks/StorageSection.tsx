import type { ReactNode } from "react";
import {
  useMediaCache,
  useStoragePaths,
  useStorageUsage,
} from "../../hooks/useStorage";
import StorageMediaCache from "./StorageMediaCache";
import StorageModuleGrid from "./StorageModuleGrid";
import StoragePaths from "./StoragePaths";
import StorageUsage from "./StorageUsage";
import { ErrorBanner } from "../common";

/** 共享存储查询，按概览、维护和路径排列存储面板与图库操作。 */
export default function StorageSection({
  overview,
  maintenance,
  records,
}: {
  overview?: ReactNode;
  maintenance?: ReactNode;
  records?: ReactNode;
}) {
  const usage = useStorageUsage();
  const paths = useStoragePaths();
  const media = useMediaCache();

  const stats = media.stats;
  const refreshAll = () => {
    void usage.refetch();
    media.refresh();
  };

  return (
    <div className="space-y-5">
      <div className="grid items-start gap-5 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-7">
          {usage.isLoading ? (
            <div
              role="status"
              className="rounded-xl border border-line bg-raised p-4 text-body text-ink-2"
            >
              正在读取本机存储信息…
            </div>
          ) : usage.isError ? (
            <ErrorBanner className="rounded-xl p-4">
              本机存储信息读取失败，请检查后端是否运行，然后刷新页面。
            </ErrorBanner>
          ) : usage.data ? (
            <StorageUsage
              mediaBytes={stats?.mediaBytes ?? 0}
              mediaFileCount={stats?.mediaFileCount ?? 0}
              outputBytes={usage.data.summary.outputBytes}
              outputFileCount={usage.data.summary.outputFileCount}
              modelBytes={usage.data.summary.modelBytes}
              modelFileCount={usage.data.summary.modelFileCount}
              onRefresh={refreshAll}
              refreshing={usage.isFetching || media.refreshing}
            />
          ) : null}
        </div>
        <div className="min-w-0 xl:col-span-5">{overview}</div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <div className="min-w-0 space-y-5">
          <StorageMediaCache
            loading={media.loading}
            refreshing={media.refreshing}
            clearing={media.clearing}
            totalBytes={stats?.mediaBytes}
            totalFileCount={stats?.mediaFileCount}
            scannedAt={stats?.scannedAt}
            ttlSeconds={stats?.cacheTtlSeconds}
            sub={{
              thumbs: stats?.thumbs ?? emptySubUsage,
              converted: stats?.converted ?? emptySubUsage,
              previews: stats?.previews ?? emptySubUsage,
              videoFaststart: stats?.videoFaststart ?? emptySubUsage,
              videoTranscode: stats?.videoTranscode ?? emptySubUsage,
            }}
            onRefresh={media.refresh}
            onClear={media.clear}
            onClearAll={media.clearAll}
          />

          {maintenance}
        </div>
        <div className="min-w-0 space-y-5">
          {usage.data ? (
            <StorageModuleGrid modules={usage.data.modules} />
          ) : null}
          {records}
        </div>
      </div>

      <StoragePaths
        relative={usage.data?.paths}
        modules={usage.data?.modules}
        absolute={paths.data}
        absoluteError={paths.error}
        onRetryAbsolute={() => void paths.refetch()}
      />
    </div>
  );
}

const emptySubUsage = {
  path: "",
  bytes: 0,
  fileCount: 0,
  available: false,
};
