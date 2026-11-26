import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { albumsApi, type SmartAlbumDirectoryItem } from "../../api/albums";
import {
  smartAlbumQueryKeys,
  useSmartAlbumDirectory,
} from "../../hooks/useSmartAlbums";
import { smartAlbumEvidenceDimensions, smartGroupHref } from "../../utils/smartAlbum";
import ErrorBanner from "../../features/common/ErrorBanner";
import EmptyState from "../../features/common/EmptyState";
import RenditionImage from "../../features/common/RenditionImage";
import { SparkleIcon } from "../../ui/icons";
import ExploreCard from "./ExploreCard";
import { smartAlbumsRoute } from "../../utils/path";

/** 预览最多列几个主题：只摆精选的几个，完整结果去主题页看。 */
const THEME_LIMIT = 4;

/**
 * 发现页的主题预览。
 *
 * 主题摆成**几张卡**，不是一行行的事：用户要的是「这些照片凑在一起
 * 是什么」，画面、名字与出处才是答案 —— 一张放大到撑满半屏的封面只
 * 说明「有照片」，不说明是什么。
 *
 * 卡片用实际成员的封面当画面（主题本来就是一组照片），线索收进悬停
 * 提示：每张卡都挂一行「线索：时间 · 地点」，一屏四张就是四行几乎
 * 一样的灰字，读不出差别。完整的主题清单在主题页。
 */
export default function ExploreThemePreview() {
  const queryClient = useQueryClient();
  const directory = useSmartAlbumDirectory("featured", true, {
    limit: THEME_LIMIT,
  });
  const emptyFeatured =
    !directory.isLoading && !directory.isError && directory.items.length === 0;
  const allDirectory = useSmartAlbumDirectory("all", emptyFeatured, {
    limit: 1,
  });
  const refresh = useQuery({
    queryKey: ["smart-albums", "refresh", "active"],
    queryFn: ({ signal }) => albumsApi.smartAlbumRefreshActive(signal),
    enabled: emptyFeatured,
    staleTime: 1_000,
    refetchInterval: (query) => {
      const status = query.state.data?.task?.status;
      return status === "pending" || status === "running" ? 2_000 : false;
    },
  });
  const task = refresh.data?.task;

  useEffect(() => {
    if (emptyFeatured && task?.status === "complete") {
      void queryClient.invalidateQueries({
        queryKey: smartAlbumQueryKeys.directoryRoot,
      });
    }
  }, [emptyFeatured, queryClient, task?.jobId, task?.status]);

  return (
    <section className="page-section" aria-labelledby="explore-theme">
      <div className="section-heading">
        <h2 id="explore-theme" className="section-title">
          主题
        </h2>
        <span className="section-meta">自动聚在一起的照片</span>
        <Link to={smartAlbumsRoute()} className="chip ml-auto">
          全部主题
        </Link>
      </div>

      {!emptyFeatured ? (
        directory.isLoading && directory.items.length === 0 ? (
          <p className="text-body text-fg-muted">正在汇总主题…</p>
        ) : directory.isError ? (
          <ErrorBanner
            onRetry={() => void directory.refetch()}
            retrying={directory.isFetching}
          >
            主题汇总暂时读不出来。
          </ErrorBanner>
        ) : (
          <div className="explore-grid">
            {directory.items.map((item) => (
              <ThemeCard key={`${item.albumId}-${item.group.id}`} item={item} />
            ))}
          </div>
        )
      ) : allDirectory.isLoading || refresh.isLoading ? (
        <p className="text-body text-fg-muted" aria-live="polite">
          正在检查主题分组状态…
        </p>
      ) : allDirectory.isError ? (
        <ErrorBanner
          onRetry={() => void allDirectory.refetch()}
          retrying={allDirectory.isFetching}
        >
          已生成主题索引，但汇总状态暂时读不出来。
        </ErrorBanner>
      ) : refresh.isError ? (
        <ErrorBanner onRetry={() => void refresh.refetch()} retrying={refresh.isFetching}>
          主题生成状态暂时读不出来。
        </ErrorBanner>
      ) : task?.status === "pending" || task?.status === "running" ? (
        <p className="text-body text-fg-muted" aria-live="polite">
          {task.status === "pending" ? "主题生成正在排队" : "正在生成主题"}
          {task.total > 0 ? ` · ${task.done}/${task.total}` : "…"}
        </p>
      ) : task?.status === "error" ? (
        <ErrorBanner onRetry={() => void refresh.refetch()}>
          上次主题生成失败，请到任务中心重新运行。
        </ErrorBanner>
      ) : allDirectory.analysis?.complete ? (
        <EmptyState
          title={
            allDirectory.total && allDirectory.total > 0
              ? "没有符合精选条件的主题"
              : "目前没有可用的主题分组"
          }
          description={
            allDirectory.total && allDirectory.total > 0
              ? "分类分析已完成，但当前分组没有达到精选推荐条件。"
              : "主题分析已完成，目前没有形成可用的分类分组。"
          }
          icon={<span aria-hidden="true">✦</span>}
          dense
        />
      ) : allDirectory.analysis ? (
        <p className="text-body text-fg-muted">
          {allDirectory.analysis.analyzedAlbums > 0
            ? `主题分析尚未完成（${allDirectory.analysis.analyzedAlbums}/${allDirectory.analysis.totalAlbums} 本相册已生成）。`
            : "主题尚未生成。"}{" "}
          <Link
            className="text-accent underline-offset-2 hover:underline"
            to="/tasks"
          >
            前往任务中心运行智能相册生成
          </Link>
        </p>
      ) : (
        <ErrorBanner onRetry={() => void allDirectory.refetch()}>
          暂时无法判断主题是否已分析，请重试。
        </ErrorBanner>
      )}
    </section>
  );
}

/**
 * 一个主题的一张卡。
 *
 * 画面是这一组照片的实际成员封面：主题本来就是一组照片，用一张封面
 * 说清「里面是什么」，比一枚抽象图标有说服力。
 */
function ThemeCard({ item }: { item: SmartAlbumDirectoryItem }) {
  const group = item.group;
  const source = [item.parentName, item.albumName].filter(Boolean).join(" / ");
  const evidence = smartAlbumEvidenceDimensions(group);
  return (
    <ExploreCard
      to={smartGroupHref(item)}
      title={group.name}
      meta={`${group.photoCount.toLocaleString("zh-CN")} 张${
        source ? ` · 来自 ${source}` : ""
      }`}
      hint={evidence.length > 0 ? `线索：${evidence.map(evidenceLabel).join(" · ")}` : undefined}
      media={
        group.coverResourceId ? (
          <RenditionImage
            fileId={group.coverResourceId}
            version={group.coverVersion}
            alt=""
            displayWidth={320}
            sizes="(max-width: 640px) 45vw, 220px"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="explore-card__placeholder">
            <SparkleIcon size={22} />
          </span>
        )
      }
    />
  );
}

/** 线索维度用用户的话写，不写算法内部的名字。 */
function evidenceLabel(dimension: string): string {
  switch (dimension) {
    case "time":
      return "时间";
    case "place":
      return "地点";
    case "people":
      return "人物";
    case "scene":
      return "场景";
    default:
      return dimension;
  }
}
