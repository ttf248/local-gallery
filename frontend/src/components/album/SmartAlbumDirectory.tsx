import { Link } from "react-router-dom";
import type {
  SmartAlbumDirectoryDimension,
  SmartAlbumDirectoryItem,
} from "../../api/albums";
import { albumRoute } from "../../utils/path";
import AlbumGridSkeleton from "./AlbumGridSkeleton";
import EmptyState from "../common/EmptyState";
import ErrorBanner from "../common/ErrorBanner";
import ListPagination from "../common/ListPagination";
import RenditionImage from "../common/RenditionImage";

interface Props {
  dimension: SmartAlbumDirectoryDimension;
  items: SmartAlbumDirectoryItem[];
  total?: number;
  viewMode: "grid" | "list";
  isLoading: boolean;
  isError: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage: boolean;
  onDimensionChange: (dimension: SmartAlbumDirectoryDimension) => void;
  onRetry: () => void;
  onLoadMore: () => void;
}

const DIMENSIONS: readonly [SmartAlbumDirectoryDimension, string][] = [
  ["all", "全部"],
  ["time", "时间"],
  ["place", "地点"],
  ["people", "人物"],
  ["scene", "场景"],
];

const DIMENSION_LABELS: Record<
  Exclude<SmartAlbumDirectoryDimension, "all">,
  string
> = {
  time: "时间",
  place: "地点",
  people: "人物",
  scene: "场景",
};

function smartGroupHref(item: SmartAlbumDirectoryItem) {
  const query = new URLSearchParams({
    view: "smart",
    dimension: item.group.dimension,
    group: item.group.id,
  });
  return `${albumRoute("photo", item.albumId)}?${query.toString()}`;
}

function SmartAlbumCard({
  item,
  viewMode,
}: {
  item: SmartAlbumDirectoryItem;
  viewMode: "grid" | "list";
}) {
  const group = item.group;
  const sourceName = [item.parentName, item.albumName]
    .filter(Boolean)
    .join(" / ");

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-sm transition-shadow hover:shadow-md">
      <Link
        to={smartGroupHref(item)}
        className={`group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${
          viewMode === "list" ? "sm:flex" : ""
        }`}
        aria-label={`打开智能相册 ${group.name}，来自 ${sourceName}，${group.photoCount} 张照片`}
      >
        <div
          className={`relative overflow-hidden bg-bg-subtle ${
            viewMode === "list"
              ? "aspect-[4/3] sm:aspect-auto sm:h-28 sm:w-40 sm:shrink-0"
              : "aspect-[4/3]"
          }`}
        >
          {group.coverResourceId ? (
            <RenditionImage
              fileId={group.coverResourceId}
              version={group.coverVersion}
              alt=""
              displayWidth={320}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-meta text-fg-subtle">
              暂无封面
            </div>
          )}
          <span className="absolute left-3 top-3 rounded-full border border-border/70 bg-bg/90 px-2 py-1 text-xs text-fg-muted backdrop-blur-sm">
            {DIMENSION_LABELS[group.dimension]}
          </span>
        </div>
        <div className="min-w-0 p-3">
          <h3
            className="truncate text-body font-medium text-fg"
            title={group.name}
          >
            {group.name}
          </h3>
          <p
            className="mt-1 truncate text-meta text-fg-muted"
            title={sourceName}
          >
            来自 {sourceName}
          </p>
          <p className="mt-2 text-meta tabular-nums text-fg-subtle">
            {group.photoCount} 张照片
          </p>
        </div>
      </Link>
    </article>
  );
}

export default function SmartAlbumDirectory({
  dimension,
  items,
  total,
  viewMode,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onDimensionChange,
  onRetry,
  onLoadMore,
}: Props) {
  const label =
    dimension === "all" ? "智能相册" : `${DIMENSION_LABELS[dimension]}智能相册`;

  return (
    <div className="pb-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="智能相册维度"
          className="flex flex-wrap gap-2"
        >
          {DIMENSIONS.map(([key, name]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={dimension === key}
              onClick={() => onDimensionChange(key)}
              className={`rounded-full border px-3 py-1.5 text-meta transition-colors ${
                dimension === key
                  ? "border-brand/40 bg-brand/10 text-brand-ink"
                  : "border-border bg-bg-elevated text-fg-muted hover:text-fg"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
        {typeof total === "number" && (
          <span className="text-meta tabular-nums text-fg-muted">
            共 {total} 组
          </span>
        )}
      </div>

      {isError && items.length > 0 && (
        <ErrorBanner
          kind="warning"
          className="mb-4"
          onRetry={onRetry}
          retrying={isLoading}
        >
          智能相册列表更新失败，已加载的分组仍可打开。
        </ErrorBanner>
      )}

      {isLoading && items.length === 0 ? (
        <AlbumGridSkeleton
          variant={viewMode}
          bare
          label="正在汇总已生成的智能相册…"
        />
      ) : isError && items.length === 0 ? (
        <ErrorBanner className="mt-4" onRetry={onRetry} retrying={isLoading}>
          智能相册汇总暂时读不出来。
        </ErrorBanner>
      ) : items.length === 0 ? (
        <EmptyState
          title={dimension === "all" ? "还没有智能相册分组" : `还没有${label}`}
          description={directoryEmptyDescription(dimension)}
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
        <div
          className={
            viewMode === "list"
              ? "space-y-2"
              : "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          }
        >
          {items.map((item) => (
            <SmartAlbumCard
              key={`${item.albumId}:${item.group.dimension}:${item.group.id}`}
              item={item}
              viewMode={viewMode}
            />
          ))}
        </div>
      )}

      <ListPagination
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        isError={isError}
        load={onLoadMore}
      />
    </div>
  );
}

function directoryEmptyDescription(
  dimension: SmartAlbumDirectoryDimension,
): string {
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
