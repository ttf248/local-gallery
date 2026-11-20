import { useCallback, useEffect, useMemo, useState } from "react";
import "../styles/similarity.css";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Virtuoso } from "react-virtuoso";
import PageHeading from "../components/common/PageHeading";
import Segmented from "../components/common/Segmented";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";
import PhotoCompare, {
  type CompareItem,
} from "../components/wall/PhotoCompare";
import Popover, {
  PopoverItem,
  PopoverLabel,
} from "../components/common/Popover";
import { FolderIcon } from "../components/common/Icon";
import SimilarityGroupCard from "../components/similarity/SimilarityGroupCard";
import {
  useSimilarityGroups,
  useSimilarityStatus,
} from "../hooks/useSimilarity";
import { aiJobsApi } from "../api/aiJobs";
import { useUIStore } from "../store/uiStore";
import type {
  SimilarityBatchAction,
  SimilarityGroupKind,
  SimilarityGroupStatus,
} from "../api/similarity";

const KIND_PARAM = "kind";
const STATUS_PARAM = "status";
const FOLDER_PARAM = "folder";

const KIND_OPTIONS: { value: SimilarityGroupKind | ""; label: string }[] = [
  { value: "", label: "全部" },
  { value: "exact", label: "完全重复" },
  { value: "near", label: "近似重复" },
  { value: "burst", label: "连拍" },
];

const STATUS_OPTIONS: { value: SimilarityGroupStatus | ""; label: string }[] = [
  { value: "", label: "全部" },
  { value: "pending", label: "待整理" },
  { value: "reviewed", label: "已审查" },
  { value: "ignored", label: "已忽略" },
];

/**
 * 相似照片与连拍整理。
 *
 * 这一页回答一个具体问题：「这些照片里哪些是同一张，哪些是一组连拍，
 * 该留哪一张」。三类结果分开摆，不混成一句「重复」——
 * 把连拍说成重复是这一页最容易犯的错。
 *
 * 页面本身不重活：分组由后台分析算好，这里只负责筛选、比对与记录
 * 用户的决定。任何写操作都只落在人工决定与精选集合上，
 * 原始照片一个字节都不动。
 */
export default function Similarity() {
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = readParam(searchParams.get(KIND_PARAM)) as
    SimilarityGroupKind | "";
  const status = readParam(searchParams.get(STATUS_PARAM)) as
    SimilarityGroupStatus | "";
  const folder = searchParams.get(FOLDER_PARAM) ?? "";

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [comparePair, setComparePair] = useState<[string, string] | null>(null);

  const pushToast = useUIStore((state) => state.pushToast);
  const groups = useSimilarityGroups({ kind, status, folder });
  const moduleStatus = useSimilarityStatus();
  const queryClient = useQueryClient();
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = groups;

  // 筛选条件写进地址栏：这一页看的就是某个切面，链接要能带过去。
  const updateParam = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set(name, value);
      } else {
        params.delete(name);
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const loadMoreGroups = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const handleUpdate = useCallback(
    async (
      id: string,
      body: { representative?: string; reviewed?: boolean; ignored?: boolean },
    ) => {
      try {
        await groups.update.mutateAsync({ id, body });
      } catch (error) {
        pushToast({
          kind: "error",
          message: `没能保存这个决定：${describeError(error)}`,
        });
      }
    },
    [groups, pushToast],
  );

  /** 把一组的代表照片加入精选：不必先勾选这一组。 */
  const handlePickGroup = useCallback(
    async (groupId: string) => {
      try {
        const result = await groups.batch.mutateAsync({
          action: "pick",
          groupIds: [groupId],
        });
        pushToast({
          kind: "success",
          message: result.changed
            ? "已把代表照片加入精选"
            : "这张照片已经在精选里了",
        });
      } catch (error) {
        pushToast({
          kind: "error",
          message: `没能加入精选：${describeError(error)}`,
        });
      }
    },
    [groups, pushToast],
  );

  const handleBatch = useCallback(
    async (action: SimilarityBatchAction) => {
      const ids = [...selectedIds];
      if (ids.length === 0) return;
      try {
        const result = await groups.batch.mutateAsync({
          action,
          groupIds: ids,
        });
        if (action === "pick") {
          pushToast({
            kind: "success",
            message: `已把 ${result.changed} 张代表照片加入精选`,
          });
        } else {
          pushToast({
            kind: "success",
            message: `已处理 ${result.changed} 组`,
          });
        }
        setSelectedIds(new Set());
      } catch (error) {
        pushToast({
          kind: "error",
          message: `批量操作没成功：${describeError(error)}`,
        });
      }
    },
    [groups, pushToast, selectedIds],
  );

  // 展开状态与勾选状态在换筛选时清掉：上一组结果可能不在新切面里了。
  useEffect(() => {
    setExpandedIds(new Set());
    setSelectedIds(new Set());
  }, [kind, status, folder]);

  const items = groups.groups;
  const summary = groups.page?.summary;
  const folders = groups.page?.folders ?? [];
  const statusInfo = moduleStatus.status;

  const compareItems = useMemo<[CompareItem, CompareItem] | null>(() => {
    if (!comparePair) return null;
    const left = items
      .flatMap((group) => group.members)
      .find((member) => member.resourceId === comparePair[0]);
    const right = items
      .flatMap((group) => group.members)
      .find((member) => member.resourceId === comparePair[1]);
    if (!left || !right) return null;
    return [
      {
        id: left.resourceId,
        name: left.albumName || "照片",
        width: left.width,
        height: left.height,
        albumName: left.folder,
      },
      {
        id: right.resourceId,
        name: right.albumName || "照片",
        width: right.width,
        height: right.height,
        albumName: right.folder,
      },
    ];
  }, [comparePair, items]);

  const isEmpty = !groups.isLoading && items.length === 0;

  return (
    <div className="min-h-full pb-10">
      <PageHeading
        eyebrow="本机整理"
        title="相似照片与连拍"
        description={
          <>
            完全重复按文件内容判定，近似重复按画面判定，连拍只标出「同一个瞬间」，
            不当成重复。三类结果各自独立，任何一步都不会删除、移动或改写原始照片。
          </>
        }
        action={
          <div className="flex items-center gap-2">
            <RebuildButton
              stale={Boolean(groups.page?.stale)}
              rebuilding={groups.rebuild.isPending}
              onRebuild={() => {
                void groups.rebuild
                  .mutateAsync()
                  .then(() => {
                    pushToast({ kind: "success", message: "分组已重算" });
                  })
                  .catch((error: unknown) => {
                    pushToast({
                      kind: "error",
                      message: `没能重算分组：${describeError(error)}`,
                    });
                  })
                  .finally(() => {
                    void queryClient.invalidateQueries({
                      queryKey: ["similarity"],
                    });
                  });
              }}
            />
            <AnalyzeButton
              onStarted={() =>
                void queryClient.invalidateQueries({ queryKey: ["similarity"] })
              }
            />
          </div>
        }
      />

      <div className="page-shell">
        <div className="filter-strip flex flex-wrap items-center gap-x-5 gap-y-3">
          <Segmented
            label="结果类别"
            value={kind}
            onChange={(value) => updateParam(KIND_PARAM, value)}
            options={KIND_OPTIONS}
          />
          <Segmented
            label="整理状态"
            value={status}
            onChange={(value) => updateParam(STATUS_PARAM, value)}
            options={STATUS_OPTIONS}
          />
          {folders.length > 0 ? (
            <Popover
              align="start"
              aria-label="按文件夹查看整理结果"
              className="similarity-folder-menu"
              trigger={
                <button type="button" className="btn btn-sm">
                  <FolderIcon size={14} />
                  <span className="max-w-[220px] truncate">
                    {folder || "全部文件夹"}
                  </span>
                  {folder ? (
                    <span className="tabular-nums text-fg-subtle">
                      {folders.find((item) => item.folder === folder)?.groups ??
                        0}
                    </span>
                  ) : (
                    <span className="tabular-nums text-fg-subtle">
                      {folders.length}
                    </span>
                  )}
                </button>
              }
            >
              <PopoverLabel>按文件夹查看</PopoverLabel>
              <PopoverItem onClick={() => updateParam(FOLDER_PARAM, "")}>
                全部文件夹
              </PopoverItem>
              {folders.map((item) => (
                <PopoverItem
                  key={item.folder}
                  onClick={() => updateParam(FOLDER_PARAM, item.folder)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{item.folder}</span>
                    <span className="tabular-nums text-fg-subtle">
                      {item.groups}
                    </span>
                  </span>
                </PopoverItem>
              ))}
            </Popover>
          ) : null}
        </div>

        {summary ? (
          <p
            className="mb-4 text-meta text-fg-subtle"
            data-testid="similarity-summary"
          >
            {summary.exact + summary.near + summary.burst} 组 · {summary.exact}{" "}
            组完全重复、{summary.near} 组近似重复、{summary.burst} 组连拍 ·{" "}
            {summary.redundant} 张多余照片 · 待整理 {summary.pending} 组
            {statusInfo?.hasVectors
              ? " · 语义索引可用，复核更准"
              : " · 没有语义索引，近似判定已收紧"}
            {groups.page?.limited ? " · 本次召回触到上限，结果可能不完整" : ""}
          </p>
        ) : null}

        {groups.isError && items.length === 0 ? (
          <ErrorBanner
            className="rounded-xl"
            onRetry={() => void groups.refetch()}
            retrying={groups.isLoading || groups.isFetchingNextPage}
          >
            整理结果暂时读不出来。
          </ErrorBanner>
        ) : groups.isLoading && items.length === 0 ? (
          <p className="py-8 text-center text-meta text-fg-subtle">
            正在读取整理结果…
          </p>
        ) : isEmpty ? (
          <EmptyState
            title={emptyTitle(statusInfo?.analyzed ?? 0)}
            description={emptyDescription(statusInfo?.analyzed ?? 0)}
            icon={<span aria-hidden="true">◧</span>}
            dense
          />
        ) : (
          <Virtuoso
            data={items}
            useWindowScroll
            overscan={200}
            increaseViewportBy={{ top: 500, bottom: 700 }}
            defaultItemHeight={240}
            computeItemKey={(_index, group) => group.id}
            endReached={loadMoreGroups}
            itemContent={(_index, group) => (
              <SimilarityGroupCard
                key={group.id}
                group={group}
                expanded={expandedIds.has(group.id)}
                onToggleExpand={() => toggleExpanded(group.id)}
                selected={selectedIds.has(group.id)}
                onToggleSelect={() => toggleSelected(group.id)}
                onSetRepresentative={(resourceId) =>
                  void handleUpdate(group.id, { representative: resourceId })
                }
                onReview={() =>
                  void handleUpdate(group.id, {
                    reviewed: group.status !== "reviewed",
                  })
                }
                onIgnore={() =>
                  void handleUpdate(group.id, {
                    ignored: group.status !== "ignored",
                  })
                }
                onPick={() => void handlePickGroup(group.id)}
                onCompare={(left, right) => setComparePair([left, right])}
                busy={groups.update.isPending || groups.batch.isPending}
              />
            )}
          />
        )}

        {groups.isError && items.length > 0 ? (
          <ErrorBanner
            className="mt-4 rounded-xl"
            kind="warning"
            onRetry={() =>
              groups.isFetchNextPageError
                ? loadMoreGroups()
                : void groups.refetch()
            }
            retrying={groups.isLoading || groups.isFetchingNextPage}
          >
            {groups.isFetchNextPageError
              ? "后续分组读取失败，已加载的分组仍可整理。"
              : "整理结果更新失败，仍显示上次读取到的分组。"}
          </ErrorBanner>
        ) : null}

        {groups.hasNextPage ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              className="btn"
              onClick={loadMoreGroups}
              disabled={groups.isFetchingNextPage}
            >
              {groups.isFetchingNextPage
                ? "正在读取下一批分组…"
                : `再显示 60 组（还有 ${Math.max(0, (groups.page?.total ?? items.length) - items.length)} 组）`}
            </button>
          </div>
        ) : null}

        {selectedIds.size > 0 ? (
          <div
            className="similarity-actions"
            data-testid="similarity-batch-bar"
          >
            <span className="text-meta text-fg-muted">
              已选 {selectedIds.size} 组
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void handleBatch("pick")}
              disabled={groups.batch.isPending}
            >
              代表照片加入精选
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void handleBatch("review")}
              disabled={groups.batch.isPending}
            >
              标记已审查
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void handleBatch("ignore")}
              disabled={groups.batch.isPending}
            >
              忽略
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setSelectedIds(new Set())}
            >
              取消选择
            </button>
          </div>
        ) : null}
      </div>

      {compareItems ? (
        <PhotoCompare
          left={compareItems[0]}
          right={compareItems[1]}
          onClose={() => setComparePair(null)}
          onSwap={() =>
            setComparePair((prev) => (prev ? [prev[1], prev[0]] : prev))
          }
        />
      ) : null}
    </div>
  );
}

/**
 * 重算分组。
 *
 * 特征变了但还没重建时，分组是旧的：这时「重建」比再跑一遍分析任务
 * 快得多。分组过期时这一枚才显眼。
 */
function RebuildButton({
  stale,
  rebuilding,
  onRebuild,
}: {
  stale: boolean;
  rebuilding: boolean;
  onRebuild: () => void;
}) {
  return (
    <button
      type="button"
      className="btn"
      onClick={onRebuild}
      disabled={rebuilding}
      title="按当前特征重算分组"
    >
      {rebuilding ? "重算中…" : stale ? "分组已过期，重算" : "重算分组"}
    </button>
  );
}

/**
 * 开始分析相似照片。
 *
 * 这一步不需要本机 AI 环境：特征全在本机算。跑的是增量模式，
 * 只处理新增或变过的照片。
 */
function AnalyzeButton({ onStarted }: { onStarted: () => void }) {
  const pushToast = useUIStore((state) => state.pushToast);
  const jobs = useQuery({
    queryKey: ["ai-jobs"],
    queryFn: () => aiJobsApi.list(),
    refetchInterval: (query) => {
      const data = query.state.data;
      const active = data?.snapshot.active;
      return active && active.type === "similarity" ? 2000 : false;
    },
  });

  const start = useMutation({
    mutationFn: () => aiJobsApi.start("similarity", "incremental"),
    onSuccess: () => {
      pushToast({
        kind: "info",
        message: "已加入分析队列，跑完自动刷新整理结果",
      });
      onStarted();
    },
    onError: (error) => {
      pushToast({
        kind: "error",
        message: `没能启动分析：${describeError(error)}`,
      });
    },
  });

  const active = jobs.data?.snapshot.active;
  const running = active?.type === "similarity" && active.status === "running";
  const pending = active?.type === "similarity" && active.status === "pending";

  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => start.mutate()}
      disabled={running || pending || start.isPending}
    >
      {running
        ? `正在分析 ${active?.completed ?? 0}/${active?.planned ?? 0}`
        : pending
          ? "已排队"
          : "分析相似照片"}
    </button>
  );
}

/** 读地址栏里的参数：认不出来的按「全部」处理。 */
function readParam(value: string | null): string {
  if (!value) return "";
  return value;
}

/** 空的说法：没分析过与分析过但没结果，是两回事。 */
function emptyTitle(analyzed: number): string {
  if (analyzed <= 0) return "还没有分析过照片";
  return "这个筛选下没有需要整理的照片";
}

/** 空态的说明。 */
function emptyDescription(analyzed: number): string {
  if (analyzed <= 0) {
    return "点右上角的「分析相似照片」跑一次。它在本机算，不联网也不改动原始文件。";
  }
  return "换个类别或状态看看，或者把「已忽略」的组放回待整理。";
}

/** 把错误说成人话。 */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "未知错误";
}
