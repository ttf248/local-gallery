import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { aiJobsApi, type AIJob, type ChinaPlace } from "../../api/aiJobs";
import { useChinaPlacesAll } from "../../hooks/useChinaLocations";
import ErrorBanner from "../common/ErrorBanner";
import RenditionImage from "../common/RenditionImage";
import { travelPlaceRoute, travelsRoute } from "../../utils/path";

/** 预览最多列几个地方：这是入口，不是一张地点清单。 */
const PLACE_LIMIT = 8;

/**
 * 发现页的地点预览。
 *
 * 地点全部在本机解析（离线行政区边界），不请求在线地图：预览里摆的
 * 每一个地方都能点进去看到那几天的照片，点不动的空入口不摆。
 */
export default function ExplorePlacePreview() {
  const places = useChinaPlacesAll("city", null);
  const jobs = useQuery({
    queryKey: ["ai-jobs"],
    queryFn: aiJobsApi.list,
    staleTime: 30_000,
  });
  const items = useMemo(
    () =>
      [...(places.data ?? [])]
        .sort((left, right) => right.photoCount - left.photoCount)
        .slice(0, PLACE_LIMIT),
    [places.data],
  );

  return (
    <section className="page-shell page-section" aria-labelledby="explore-place">
      <div className="section-heading">
        <h2 id="explore-place" className="section-title">
          地点
        </h2>
        <span className="section-meta">去过的地方</span>
        <Link to={travelsRoute()} className="chip ml-auto">
          足迹
        </Link>
      </div>

      {places.isError && places.data ? (
        <ErrorBanner
          onRetry={() => void places.refetch()}
          retrying={places.isFetching}
        >
          地点数据更新失败，下面仍显示上次读取到的结果。
        </ErrorBanner>
      ) : null}
      {places.isError && !places.data ? (
        <ErrorBanner
          onRetry={() => void places.refetch()}
          retrying={places.isFetching}
        >
          地点数据暂时读不出来。
        </ErrorBanner>
      ) : null}

      {places.isLoading && !places.data ? (
        <p className="text-body text-fg-muted">正在读取地点…</p>
      ) : null}

      {!places.isLoading && !places.isError && items.length === 0 ? (
        <PlaceEmptyState
          jobs={jobs.data?.snapshot.jobs ?? []}
          isLoading={jobs.isLoading}
          isError={jobs.isError}
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {items.map((place) => (
              <PlaceRow key={place.adcode} place={place} />
            ))}
          </ul>
          <p className="mt-3 text-meta text-fg-subtle">
            位置来自照片自带的坐标与基站信息，全部在本机解析，不请求在线地图。
          </p>
        </>
      ) : null}
    </section>
  );
}

function PlaceRow({ place }: { place: ChinaPlace }) {
  const cover = place.coverResourceIds?.[0];
  return (
    <li>
      <Link
        to={travelPlaceRoute(place.adcode)}
        className="flex items-center gap-3 rounded-lg border border-border-faint bg-bg-elevated p-2 transition-colors hover:border-border-strong"
      >
        <span className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-bg-subtle">
          {cover ? (
            <RenditionImage
              fileId={cover}
              alt=""
              displayWidth={96}
              className="h-full w-full object-cover"
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-fg">
            {place.name}
          </span>
          <span className="mt-0.5 block truncate text-meta tabular-nums text-fg-muted">
            {place.photoCount.toLocaleString("zh-CN")} 张
            {place.visitCount > 0 ? ` · 去过 ${place.visitCount} 次` : ""}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * 没有地点时的实话。
 *
 * 分清「还没跑元数据分析」「分析跑了但照片没有坐标」「分析失败」——
 * 每一种的下一步都不一样。
 */
function PlaceEmptyState({
  jobs,
  isLoading,
  isError,
}: {
  jobs: AIJob[];
  isLoading: boolean;
  isError: boolean;
}) {
  const latestMetadataJob = jobs
    .filter((job) => job.type === "metadata")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const running =
    latestMetadataJob?.status === "pending" ||
    latestMetadataJob?.status === "running" ||
    latestMetadataJob?.status === "paused";

  if (isLoading && !isError) {
    return (
      <p className="text-body text-fg-muted">正在检查 GPS 分析状态…</p>
    );
  }
  if (isError) {
    return (
      <ErrorBanner>
        GPS 分析状态暂时读不出来。
      </ErrorBanner>
    );
  }
  if (running) {
    return (
      <p className="text-body text-fg-muted" aria-live="polite">
        元数据分析正在进行，地点结果会在完成后更新。
      </p>
    );
  }
  if (latestMetadataJob?.status === "failed") {
    return (
      <p className="text-body text-fg-muted">
        上次元数据分析失败，暂时无法确认地点结果。
        <Link
          className="ml-1 text-brand underline-offset-2 hover:underline"
          to="/tasks"
        >
          查看任务记录
        </Link>
      </p>
    );
  }
  if (latestMetadataJob?.status === "completed") {
    return (
      <p className="text-body text-fg-muted">
        元数据分析已完成，目前没有解析出可用于足迹的位置。
      </p>
    );
  }
  return (
    <p className="text-body text-fg-muted">
      尚未完成元数据 / GPS 分析。运行一次元数据分析后，这里会显示已解析出位置的照片。
      <Link
        className="ml-1 text-brand underline-offset-2 hover:underline"
        to="/tasks/plan"
      >
        打开任务中心
      </Link>
    </p>
  );
}
