import { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useSmartAlbumDimensionCounts,
  useSmartAlbumDirectory,
} from "../hooks/useSmartAlbums";
import type {
  SmartAlbumDimension,
  SmartAlbumDirectoryDimension,
} from "../api/albums";
import SmartAlbumWall from "../components/album/SmartAlbumWall";
import AlbumGridSkeleton from "../components/album/AlbumGridSkeleton";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";

const DIMENSION_PARAM = "dimension";

const DIMENSIONS: readonly {
  key: SmartAlbumDirectoryDimension;
  label: string;
}[] = [
  { key: "all", label: "全部" },
  { key: "time", label: "时间" },
  { key: "place", label: "地点" },
  { key: "people", label: "人物" },
  { key: "scene", label: "场景" },
];

function parseDimension(value: string | null): SmartAlbumDirectoryDimension {
  switch (value) {
    case "time":
    case "place":
    case "people":
    case "scene":
      return value;
    default:
      return "all";
  }
}

/**
 * 智能相册：全库已生成的智能分组汇成的一面墙。
 *
 * 分组是相册内部的自动归类（按时间、按地点、按人物、按场景），
 * 每一本照片相册各算各的。这里的目录把各本的分组摊到一页上，
 * 按线索分组翻阅。
 *
 * 墙是无限下拉的：滑到底自动接下一批，不用点「加载更多」——
 * 四千多组分组一页页点按钮是不可能的事。
 */
export default function SmartAlbums() {
  const [searchParams, setSearchParams] = useSearchParams();
  const dimension = parseDimension(searchParams.get(DIMENSION_PARAM));
  const directory = useSmartAlbumDirectory(dimension, true);
  const { counts, total } = useSmartAlbumDimensionCounts(true);

  const setDimension = (next: SmartAlbumDirectoryDimension) => {
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete(DIMENSION_PARAM);
    else params.set(DIMENSION_PARAM, next);
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params);
    }
  };

  const items = directory.items;
  const isInitialLoading = directory.isLoading && items.length === 0;

  // 换维度就是换一面墙：停在原来那一屏的位置上，看到的还是上一维度的分组。
  useEffect(() => {
    document.querySelector(".app-main")?.scrollTo({ top: 0 });
  }, [dimension]);

  // 当前维度的组数：目录接口的 total 就是它。
  // 「全部」没有单独的 total，用四个维度之和（它们本就是同一批分组）。
  const currentTotal = useMemo(() => {
    if (dimension === "all") return total ?? directory.total;
    return counts[dimension] ?? directory.total;
  }, [dimension, total, counts, directory.total]);

  // 无限下拉：快滑到底时就把下一批接上，滑到底时分组已经在那里。
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasNextPage = directory.hasNextPage ?? false;
  const isFetchingNextPage = directory.isFetchingNextPage;
  const fetchNextPage = directory.fetchNextPage;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (!hasNextPage || isFetchingNextPage) return;
        void fetchNextPage();
      },
      // 提前一屏接上：等真的滑到底再请求，会有一次明显的空档。
      { rootMargin: "800px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="min-h-full pb-10">
      <header className="sticky top-0 z-20 border-b border-border-faint bg-bg">
        <div className="page-shell flex items-center justify-between gap-4 py-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="page-eyebrow shrink-0">智能分组</span>
            <h1 className="page-title page-title--sm truncate">智能相册</h1>
          </div>
          {typeof currentTotal === "number" && (
            <span className="shrink-0 text-meta tabular-nums text-fg-muted">
              共 {currentTotal} 组
            </span>
          )}
        </div>
        <div
          role="tablist"
          aria-label="智能相册维度"
          className="page-shell flex flex-wrap gap-2 pb-3"
        >
          {DIMENSIONS.map((entry) => {
            const count = dimensionCount(entry.key, counts, total);
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={dimension === entry.key}
                onClick={() => setDimension(entry.key)}
                className={`rounded-full border px-3 py-1.5 text-meta transition-colors ${
                  dimension === entry.key
                    ? "border-brand/40 bg-brand/10 text-brand-ink"
                    : "border-border bg-bg-elevated text-fg-muted hover:text-fg"
                }`}
              >
                {entry.label}
                {count !== undefined && (
                  <span className="ml-1.5 tabular-nums text-fg-subtle">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      <div className="page-shell pt-4">
        {isInitialLoading ? (
          <AlbumGridSkeleton
            count={10}
            bare
            label="正在汇总已生成的智能相册…"
          />
        ) : directory.isError && items.length === 0 ? (
          <ErrorBanner
            className="rounded-xl"
            onRetry={() => void directory.refetch()}
            retrying={directory.isLoading}
          >
            智能相册汇总暂时读不出来。
          </ErrorBanner>
        ) : items.length === 0 ? (
          <EmptyState
            title={dimension === "all" ? "还没有智能相册分组" : "这一类还没有分组"}
            description={dimensionDescription(dimension)}
            action={
              dimension === "all" ? undefined : (
                <Link
                  to={dimension === "people" ? "/tasks/plan" : "/tasks/run"}
                  className="btn btn-sm btn-outline"
                >
                  打开任务中心
                </Link>
              )
            }
            icon={<span aria-hidden="true">✦</span>}
            dense
          />
        ) : (
          <>
            <SmartAlbumWall items={items} />
            <div
              ref={sentinelRef}
              className="h-px"
              aria-hidden="true"
              data-testid="smart-albums-sentinel"
            />
            {isFetchingNextPage ? (
              <p className="py-4 text-center text-meta text-fg-subtle">
                正在接下一批…
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** 某个维度页签上的组数。 */
function dimensionCount(
  dimension: SmartAlbumDirectoryDimension,
  counts: Partial<Record<SmartAlbumDimension, number>>,
  total: number | undefined,
): number | undefined {
  if (dimension === "all") return total;
  return counts[dimension];
}

/** 某个维度为什么还没有分组。 */
function dimensionDescription(dimension: SmartAlbumDirectoryDimension): string {
  switch (dimension) {
    case "time":
      return "时间分组依赖 EXIF 拍摄时间。到任务中心运行元数据分析，再打开照片相册生成或刷新分组。";
    case "place":
      return "地点分组依赖照片中的 GPS 或可用地点线索。先运行元数据分析；没有位置数据的照片不会被猜测归类。";
    case "people":
      return "人物分组依赖人脸分析。需先在每日计划启用人物分析，再运行人脸任务；识别结果只保存在本机。";
    case "scene":
      return "场景分组依赖 Chinese-CLIP 语义向量。到任务中心运行语义向量分析，再打开照片相册生成或刷新分组。";
    case "all":
    default:
      return "智能相册按时间、地点、人物和场景分组。每个维度都需要对应的照片线索；打开单本照片相册可查看覆盖率并补充分析。";
  }
}
