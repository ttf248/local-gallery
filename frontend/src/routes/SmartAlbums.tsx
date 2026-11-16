import { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useSmartAlbumDimensionCounts,
  useSmartAlbumDirectory,
} from "../hooks/useSmartAlbums";
import type {
  SmartAlbumDimension,
  SmartAlbumDirectoryDimension,
  SmartAlbumDirectoryItem,
} from "../api/albums";
import SmartAlbumWall from "../components/album/SmartAlbumWall";
import AlbumGridSkeleton from "../components/album/AlbumGridSkeleton";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";
import { albumRoute } from "../utils/path";

const DIMENSION_PARAM = "dimension";

const DIMENSIONS: readonly {
  key: SmartAlbumDirectoryDimension;
  label: string;
}[] = [
  { key: "recommended", label: "精选推荐" },
  { key: "time", label: "时间" },
  { key: "place", label: "地点" },
  { key: "people", label: "人物" },
  { key: "scene", label: "场景" },
  { key: "all", label: "全部分类" },
];

function parseDimension(value: string | null): SmartAlbumDirectoryDimension {
  switch (value) {
    case "recommended":
    case "time":
    case "place":
    case "people":
    case "scene":
    case "all":
      return value;
    default:
      return "recommended";
  }
}

/**
 * 智能相册先按来源文件夹展示精选主题，时间、地点、人物和场景保留为
 * 可筛选的详细分类。目录分页只读已生成缓存，不在浏览时触发分析。
 */
export default function SmartAlbums() {
  const [searchParams, setSearchParams] = useSearchParams();
  const dimension = parseDimension(searchParams.get(DIMENSION_PARAM));
  const directory = useSmartAlbumDirectory(dimension, true);
  const { counts, total } = useSmartAlbumDimensionCounts(true);

  const setDimension = (next: SmartAlbumDirectoryDimension) => {
    const params = new URLSearchParams(searchParams);
    if (next === "recommended") params.delete(DIMENSION_PARAM);
    else params.set(DIMENSION_PARAM, next);
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params);
    }
  };

  const items = directory.items;
  const sections = useMemo(() => groupByAlbum(items), [items]);
  const isInitialLoading = directory.isLoading && items.length === 0;

  // 换维度就是换一面墙：停在原来那一屏的位置上，看到的还是上一维度的分组。
  useEffect(() => {
    document.querySelector(".app-main")?.scrollTo({ top: 0 });
  }, [dimension]);

  // 当前维度的组数。「全部」是四类详细维度之和（后端也这么算），
  // 其余维度的组数取自计数查询 —— 计数查询是按维度各问一次，
  // 拿当前目录的 total 去填别的维度会把组数串台。
  const currentTotal = useMemo(() => {
    if (dimension === "all") return total ?? directory.total;
    if (dimension === "featured") return directory.total;
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
            // 页签上的组数一律取自计数查询：每个页签各问一次，
            // 不看当前选中的是哪一维。
            const count =
              entry.key === "all" ? total : countFor(counts, entry.key);
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
        {dimension === "recommended" && (
          <p className="mb-6 border-b border-border-faint pb-3 text-meta text-fg-muted">
            精选推荐至少 12 张、至少两类线索一致（时间 / 地点 / 人物 /
            场景），且不与所在文件夹重复。
          </p>
        )}
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
            title={
              dimension === "recommended"
                ? "暂时没有精选推荐"
                : dimension === "all"
                  ? "还没有详细分组"
                  : "这一类还没有分组"
            }
            description={dimensionDescription(dimension)}
            action={
              dimension === "all" || dimension === "recommended" ? undefined : (
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
            <div className="space-y-9">
              {sections.map((section) => (
                <section
                  key={section.albumId}
                  aria-labelledby={`smart-album-source-${section.albumId}`}
                  className="border-b border-border-faint pb-8 last:border-b-0"
                >
                  <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-meta text-fg-subtle">
                        {section.parentName || "来源文件夹"}
                      </p>
                      <h2
                        id={`smart-album-source-${section.albumId}`}
                        className="truncate text-title font-semibold text-fg"
                      >
                        {section.albumName}
                      </h2>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-meta text-fg-muted">
                        {section.items.length} 组
                      </span>
                      <Link
                        to={`${albumRoute("photo", section.albumId)}?view=smart`}
                        className="inline-flex min-h-7 items-center rounded-md px-2 text-meta text-brand hover:bg-bg-subtle hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        查看来源相册
                      </Link>
                    </div>
                  </header>
                  <SmartAlbumWall items={section.items} />
                </section>
              ))}
            </div>
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

/**
 * 按来源相册分块。
 *
 * 按 albumId 归并而不是只合并相邻的：分页可能把同一本相册切成两段
 * （只有推荐维度会把一页延伸到相册边界），只合并相邻的会让这本相册
 * 在墙上出现两次，标题也重复。
 */
function groupByAlbum(items: SmartAlbumDirectoryItem[]) {
  const sections: {
    albumId: string;
    albumName: string;
    parentName?: string;
    items: SmartAlbumDirectoryItem[];
  }[] = [];
  const byAlbum = new Map<string, (typeof sections)[number]>();
  for (const item of items) {
    let section = byAlbum.get(item.albumId);
    if (!section) {
      section = {
        albumId: item.albumId,
        albumName: item.albumName,
        parentName: item.parentName,
        items: [],
      };
      byAlbum.set(item.albumId, section);
      sections.push(section);
    }
    section.items.push(item);
  }
  return sections;
}

/**
 * 某个维度有多少组。
 *
 * 计数查询只覆盖五个维度；「featured」是首页专用的取样视图，没有计数。
 */
function countFor(
  counts: Partial<Record<SmartAlbumDimension, number>>,
  dimension: SmartAlbumDirectoryDimension,
): number | undefined {
  if (dimension === "all" || dimension === "featured") return undefined;
  return counts[dimension];
}

/** 某个维度为什么还没有分组。 */
function dimensionDescription(dimension: SmartAlbumDirectoryDimension): string {
  switch (dimension) {
    case "recommended":
      return "精选推荐只展示至少 12 张、至少两类线索一致且不与所在文件夹重复的主题；没有合适结果时可以留空。时间、地点、人物和场景分类仍可在上方筛选。";
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
      return "按来源文件夹查看全部时间、地点、人物和场景分类；这一页不含精选推荐。详细分类允许重叠，精选推荐单独成页并抑制近似结果。";
  }
}
