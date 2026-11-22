import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { albumsApi, type SmartAlbumDirectoryItem } from "../../api/albums";
import {
  smartAlbumQueryKeys,
  useSmartAlbumDirectory,
} from "../../hooks/useSmartAlbums";
import { smartAlbumEvidenceDimensions, smartGroupHref } from "../../utils/smartAlbum";
import ErrorBanner from "../common/ErrorBanner";
import EmptyState from "../common/EmptyState";
import RenditionImage from "../common/RenditionImage";
import { smartAlbumsRoute } from "../../utils/path";

/** 预览最多列几个主题。 */
const THEME_LIMIT = 6;

/**
 * 发现页的主题预览。
 *
 * 主题摆成**一行行的事**，不是一面大封面墙：用户要的是「这些照片凑
 * 在一起是什么」，标题、几张照片、出自哪本相册才是答案 —— 一张放大到
 * 撑满半屏的封面只说明「有照片」，不说明是什么。
 *
 * 线索用用户的话写（时间 · 地点 · 人物 · 场景），不写「推荐」这种
 * 算法内部的说法。
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
    <section className="page-shell page-section" aria-labelledby="explore-theme">
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
          <ul className="space-y-2">
            {directory.items.map((item) => (
              <ThemeRow key={`${item.albumId}-${item.group.id}`} item={item} />
            ))}
          </ul>
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
 * 一个主题的一行。
 *
 * 左边一张小图（让人认得出是照片），右边写清是什么、几张、出自哪里。
 */
function ThemeRow({ item }: { item: SmartAlbumDirectoryItem }) {
  const group = item.group;
  const source = [item.parentName, item.albumName].filter(Boolean).join(" / ");
  const evidence = smartAlbumEvidenceDimensions(group);
  return (
    <li>
      <Link to={smartGroupHref(item)} className="tile-row">
        <span className="tile-row__thumb">
          {group.coverResourceId ? (
            <RenditionImage
              fileId={group.coverResourceId}
              version={group.coverVersion}
              alt=""
              displayWidth={96}
              className="h-full w-full object-cover"
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-fg">
            {group.name}
          </span>
          <span className="mt-0.5 block truncate text-meta tabular-nums text-fg-muted">
            {group.photoCount.toLocaleString("zh-CN")} 张
            {source ? ` · 来自 ${source}` : ""}
          </span>
          {evidence.length > 0 ? (
            <span className="mt-0.5 block truncate text-meta text-fg-subtle">
              线索：{evidence.map(evidenceLabel).join(" · ")}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
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
