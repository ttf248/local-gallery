import { ExploreSection, PreviewSkeleton } from "./ExploreSection";

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { aiJobsApi, type AIJob, type ChinaPlace } from "../../api/aiJobs";
import { useChinaPlacesAll } from "../../hooks/useChinaLocations";
import { InlineAlert } from "../../ui/InlineAlert";
import { RenditionImage } from "../common";
import { ImageIcon } from "../../ui/icons";
import { travelPlaceRoute, travelsRoute } from "../../utils/path";

/** 预览最多列几个地方：这是入口，不是一张地点清单。 */
const PLACE_LIMIT = 8;

/**
 * 发现页的地点预览。
 *
 * 地点全部在本机解析（离线行政区边界），不请求在线地图：预览里摆的
 * 每一个地方都能点进去看到那几天的照片，点不动的空入口不摆。
 *
 * 卡片用真实的地理照片当画面：地名本身说明不了「那是哪儿」，一张照片
 * 才说得出。没有照片的地方给一块带图标的底，而不是一块空白方框。
 */
export default function PlaceCards() {
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
    <ExploreSection
      id="explore-place"
      title="地点"
      to={travelsRoute()}
      linkLabel="足迹"
      info="仅展示有 GPS 坐标的照片。地名在本机解析，不请求在线地图。"
    >
      {places.isError && places.data ? (
        <InlineAlert
          tone="danger"
          onRetry={() => void places.refetch()}
          retrying={places.isFetching}
        >
          地点数据更新失败，下面仍显示上次读取到的结果。
        </InlineAlert>
      ) : null}
      {places.isError && !places.data ? (
        <InlineAlert
          tone="danger"
          onRetry={() => void places.refetch()}
          retrying={places.isFetching}
        >
          地点数据暂时读不出来。
        </InlineAlert>
      ) : null}

      {places.isLoading && !places.data ? (
        <PreviewSkeleton label="正在读取地点…" shape="place" />
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
          <PlaceCard place={items[0]}/>
          <ul className="mt-2 divide-y divide-line-subtle">{items.slice(1,4).map(place=><li key={place.adcode}><Link className="flex min-h-10 items-center justify-between gap-3 rounded-md px-2 text-label hover:bg-hover" to={travelPlaceRoute(place.adcode)}>
            <span>{place.name}</span><span className="text-caption tabular-nums text-ink-3">{place.photoCount.toLocaleString("zh-CN")} 张 · 去过 {place.visitCount} 次</span>
          </Link></li>)}</ul>
        </>
      ) : null}
    </ExploreSection>
  );
}

function PlaceCard({ place }: { place: ChinaPlace }) {
  const cover = place.coverResourceIds?.[0];
  return (
    <Link
      to={travelPlaceRoute(place.adcode)}
      className="group/place relative block aspect-[3/2] w-full overflow-hidden rounded-lg bg-media"
    >
      {cover ? (
        <RenditionImage
          fileId={cover}
          alt=""
          displayWidth={320}
          className="size-full object-cover transition-transform motion-safe:group-hover/place:scale-[1.03]"
        />
      ) : (
        <span className="grid size-full place-items-center text-ink-2">
          <ImageIcon />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 flex h-1/2 flex-col justify-end bg-gradient-to-t from-black/95 via-black/75 to-transparent p-4 text-white">
        <span className="w-fit text-heading">{place.name}</span>
        <span className="w-fit text-caption text-white">
          {place.photoCount.toLocaleString("zh-CN")} 张
          {place.visitCount > 0 && " · 去过 " + place.visitCount + " 次"}
        </span>
      </span>
    </Link>
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
    return <p className="text-body text-ink-2">正在检查 GPS 分析状态…</p>;
  }
  if (isError) {
    return <InlineAlert tone="danger">GPS 分析状态暂时读不出来。</InlineAlert>;
  }
  if (running) {
    return (
      <p className="text-body text-ink-2" aria-live="polite">
        元数据分析正在进行，地点结果会在完成后更新。
      </p>
    );
  }
  if (latestMetadataJob?.status === "failed") {
    return (
      <p className="text-body text-ink-2">
        上次元数据分析失败，暂时无法确认地点结果。
        <Link
          className="ml-1 text-primary underline-offset-2 hover:underline"
          to="/tasks"
        >
          查看任务记录
        </Link>
      </p>
    );
  }
  if (latestMetadataJob?.status === "completed") {
    return (
      <p className="text-body text-ink-2">
        元数据分析已完成，目前没有解析出可用于足迹的位置。
      </p>
    );
  }
  return (
    <p className="text-body text-ink-2">
      尚未完成元数据 / GPS
      分析。运行一次元数据分析后，这里会显示已解析出位置的照片。
      <Link
        className="ml-1 text-primary underline-offset-2 hover:underline"
        to="/tasks/plan"
      >
        打开任务中心
      </Link>
    </p>
  );
}
