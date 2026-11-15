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
          title="还没有已生成的智能相册"
          description={
            dimension === "all"
              ? "各文件夹内的智能分组会汇总显示在这里。先打开照片文件夹，在「智能相册」中生成分组。"
              : `目前没有已生成的${label}。在照片文件夹内生成该维度的分组后，这里会自动汇总。`
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
