import { ExploreSection, PreviewSkeleton } from "./ExploreSection";
import { ScrollRow } from "../../ui/ScrollRow";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { albumsApi, type SmartAlbumDirectoryItem } from "../../api/albums";
import {
  smartAlbumQueryKeys,
  useSmartAlbumDirectory,
} from "../../hooks/useSmartAlbums";
import {
  smartAlbumEvidenceDimensions,
  smartGroupHref,
} from "../../utils/smartAlbum";
import { InlineAlert } from "../../ui/InlineAlert";
import { EmptyState } from "../common";
import { RenditionImage } from "../common";
import { SparkleIcon } from "../../ui/icons";
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
export default function ThemeCards() {
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
    <ExploreSection
      id="explore-theme"
      title="主题"
      to={smartAlbumsRoute()}
      linkLabel="全部主题"
    >
      {!emptyFeatured ? (
        directory.isLoading && directory.items.length === 0 ? (
          <PreviewSkeleton label="正在汇总主题…" shape="theme" />
        ) : directory.isError ? (
          <InlineAlert
            tone="danger"
            onRetry={() => void directory.refetch()}
            retrying={directory.isFetching}
          >
            主题汇总暂时读不出来。
          </InlineAlert>
        ) : (
          <ScrollRow label="推荐主题">
            {directory.items.map((item) => (
              <ThemeCard key={`${item.albumId}-${item.group.id}`} item={item} />
            ))}
          </ScrollRow>
        )
      ) : allDirectory.isLoading || refresh.isLoading ? (
        <p className="text-body text-ink-2" aria-live="polite">
          正在检查主题分组状态…
        </p>
      ) : allDirectory.isError ? (
        <InlineAlert
          tone="danger"
          onRetry={() => void allDirectory.refetch()}
          retrying={allDirectory.isFetching}
        >
          已生成主题索引，但汇总状态暂时读不出来。
        </InlineAlert>
      ) : refresh.isError ? (
        <InlineAlert
          tone="danger"
          onRetry={() => void refresh.refetch()}
          retrying={refresh.isFetching}
        >
          主题生成状态暂时读不出来。
        </InlineAlert>
      ) : task?.status === "pending" || task?.status === "running" ? (
        <p className="text-body text-ink-2" aria-live="polite">
          {task.status === "pending" ? "主题生成正在排队" : "正在生成主题"}
          {task.total > 0 ? ` · ${task.done}/${task.total}` : "…"}
        </p>
      ) : task?.status === "error" ? (
        <InlineAlert tone="danger" onRetry={() => void refresh.refetch()}>
          上次主题生成失败，请到任务中心重新运行。
        </InlineAlert>
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
          size="compact"
        />
      ) : allDirectory.analysis ? (
        <p className="text-body text-ink-2">
          {allDirectory.analysis.analyzedAlbums > 0
            ? `主题分析尚未完成（${allDirectory.analysis.analyzedAlbums}/${allDirectory.analysis.totalAlbums} 本相册已生成）。`
            : "主题尚未生成。"}{" "}
          <Link
            className="text-primary underline-offset-2 hover:underline"
            to="/tasks"
          >
            前往任务中心运行智能相册生成
          </Link>
        </p>
      ) : (
        <InlineAlert tone="danger" onRetry={() => void allDirectory.refetch()}>
          暂时无法判断主题是否已分析，请重试。
        </InlineAlert>
      )}
    </ExploreSection>
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
  const coverRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = coverRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const summary = useQuery({
    queryKey: smartAlbumQueryKeys.summary(item.albumId, group.dimension),
    queryFn: ({ signal }) =>
      albumsApi.smartGroups(item.albumId, group.dimension, signal),
    enabled: visible && group.photoCount > 1,
    staleTime: 30_000,
  });
  const snapshot = summary.data?.summary.snapshotKey ?? "";
  const members = useQuery({
    queryKey: [
      "smart-albums",
      "preview",
      item.albumId,
      group.dimension,
      group.id,
      snapshot,
    ],
    queryFn: ({ signal }) =>
      albumsApi.smartGroupMedia(
        item.albumId,
        group.dimension,
        group.id,
        snapshot,
        undefined,
        signal,
        4,
      ),
    enabled: visible && Boolean(snapshot),
    staleTime: 60_000,
  });
  const covers =
    members.data?.page.items
      .filter((member) => member.kind === "image")
      .slice(0, 4) ?? [];
  const source = [item.parentName, item.albumName].filter(Boolean).join(" / ");
  const evidence = smartAlbumEvidenceDimensions(group);
  return (
    <Link
      to={smartGroupHref(item)}
      title={
        evidence.length
          ? "线索：" + evidence.map(evidenceLabel).join(" · ")
          : undefined
      }
      className="w-[min(300px,76vw)] shrink-0"
    >
      <span
        ref={coverRef}
        className={
          "grid aspect-[4/3] gap-0.5 overflow-hidden rounded-lg bg-media " +
          (covers.length > 1 ? "grid-cols-2" : "place-items-center")
        }
      >
        {covers.length > 1 ? (
          covers.map((member, index) => (
            <span
              key={member.id}
              className={
                "min-h-0 min-w-0 " +
                (covers.length === 3 && index === 0 ? "row-span-2" : "")
              }
            >
              <RenditionImage
                fileId={member.id}
                version={member.version}
                alt=""
                displayWidth={160}
                className="size-full object-cover"
              />
            </span>
          ))
        ) : group.coverResourceId ? (
          <RenditionImage
            fileId={group.coverResourceId}
            version={group.coverVersion}
            alt=""
            displayWidth={320}
            className="size-full object-cover"
          />
        ) : (
          <SparkleIcon size={22} />
        )}
      </span>
      <span className="mt-2 block text-label font-semibold">
        {group.name}
      </span>
      <span className="text-caption text-ink-2">
        {group.photoCount.toLocaleString("zh-CN")} 张
        {source && " · 来自 " + source}
      </span>
    </Link>
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
