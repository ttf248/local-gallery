import { GroupList } from "../features/similarity/GroupList";
import { ReviewLayout } from "../features/similarity/ReviewLayout";
import { ReviewStage } from "../features/similarity/ReviewStage";
import { resolveSimilarityView } from "../features/similarity/reviewNavigation";
import { useSimilarityReview } from "../features/similarity/useSimilarityReview";
import { useReviewShortcuts } from "../features/similarity/useReviewShortcuts";
import { useMediaQuery, SPLIT_LAYOUT_QUERY } from "../hooks/useMediaQuery";
import { FloatingBar } from "../ui/FloatingBar";
import { Sheet } from "../ui/Sheet";
import Popover from "../ui/Popover";
import { InlineAlert } from "../ui/InlineAlert";
import { Button } from "../ui/Button";
import { PageToolbar } from "../shell/PageToolbar";
import { Page } from "../shell/Page";
import { Menu } from "../ui/Menu";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Virtuoso } from "react-virtuoso";
import { PageHero } from "../shell/PageHero";
import Segmented from "../ui/Segmented";
import { EmptyState } from "../ui/EmptyState";
import ErrorBanner from "../features/common/ErrorBanner";
import PhotoCompare, {
  type CompareItem,
} from "../features/viewer/PhotoCompare";

import { FolderIcon } from "../ui/icons";
import SimilarityGroupCard from "../features/similarity/SimilarityGroupCard";
import { useSimilarityStatus } from "../hooks/useSimilarity";
import { aiJobsApi } from "../api/aiJobs";
import { ApiError } from "../api/client";
import { useUIStore } from "../store/uiStore";
import type {
  SimilarityBatchAction,
  SimilarityGroup,
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

/**
 * 处理状态的三档，外加「全部」。
 *
 * 这一页是一列待办：进来先看待处理，处理完就落到「已处理」，
 * 不再看的那一档是「已忽略」。所以默认落在待处理上 —— 打开这一页
 * 就是要看还有什么没处理。
 *
 * 「全部」是显式的一档，不是「参数为空」：地址栏里没有 status 时
 * 默认是待处理，空串会被当成待处理，免得旧书签把筛选弄丢。
 */
type SimilarityStatusOption = SimilarityGroupStatus | "all";

const STATUS_OPTIONS: { value: SimilarityStatusOption; label: string }[] = [
  { value: "pending", label: "待处理" },
  { value: "reviewed", label: "已处理" },
  { value: "ignored", label: "已忽略" },
  { value: "all", label: "全部" },
];

/** 读地址栏里的状态：认不出来的按待处理算。 */
function readStatusOption(value: string | null): SimilarityStatusOption {
  if (value === "reviewed" || value === "ignored" || value === "all") {
    return value;
  }
  return "pending";
}

/**
 * 一次可撤销的状态变更。
 *
 * 撤销要按每一组自己的原状态恢复：「全部」视图里的组本来就五花八门
 * （有待处理、有已处理、有已忽略），统一翻一个布尔的话，已处理的会被
 * 推回待处理、已忽略的也会丢掉 —— 用户的选择全乱了。
 */
interface UndoEntry {
  groupId: string;
  /** 操作之后的状态：撤销时拿它做并发校验。 */
  from: SimilarityGroupStatus;
  /** 操作之前的状态：撤销时回到这里。 */
  to: SimilarityGroupStatus;
}

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
  const [scrollParent, setScrollParent] = useState<HTMLElement>();
  const bindScrollParent = useCallback((element: HTMLDivElement | null) => {
    if (element)
      setScrollParent(
        element.closest<HTMLElement>("main.app-main") ?? undefined,
      );
  }, []);
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = readParam(searchParams.get(KIND_PARAM)) as
    SimilarityGroupKind | "";
  const status = readStatusOption(searchParams.get(STATUS_PARAM));
  const folder = searchParams.get(FOLDER_PARAM) ?? "";

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [comparePair, setComparePair] = useState<[string, string] | null>(null);

  const pushToast = useUIStore((state) => state.pushToast);
  const wide = useMediaQuery(SPLIT_LAYOUT_QUERY);
  const view = resolveSimilarityView(searchParams.get("view"), wide);
  const reviewing = view === "review";
  const changeWorkspace = useCallback(
    (mode: string | null, groupId?: string | null) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (mode) params.set("view", mode);
          else params.delete("view");
          if (groupId !== undefined) {
            if (groupId) params.set("group", groupId);
            else params.delete("group");
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const replaceGroupId = (id: string | null) =>
    changeWorkspace(searchParams.get("view"), id);
  const review = useSimilarityReview(
    { kind, status: status === "all" ? "" : status, folder },
    {
      groupId: searchParams.get("group"),
      replaceGroupId,
      enabled: reviewing,
    },
  );
  const groups = review.source;
  const returnToList = useCallback(
    () =>
      document
        .querySelector<HTMLButtonElement>(
          "[data-review-layout] button[aria-current]",
        )
        ?.focus(),
    [],
  );
  useReviewShortcuts(review, reviewing, returnToList);
  const moduleStatus = useSimilarityStatus();
  const builtAt = moduleStatus.status?.builtAt;
  const previousBuild = useRef(builtAt);
  const reload = groups.refetch;
  useEffect(() => {
    if (builtAt && previousBuild.current && builtAt !== previousBuild.current)
      void reload();
    previousBuild.current = builtAt;
  }, [builtAt, reload]);
  const queryClient = useQueryClient();
  const {
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = groups;

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
    if (!hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError]);

  // 自动续页失败后，只有这个显式操作可以再次请求同一页。
  const retryNextPage = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const handleUpdate = useCallback(
    async (
      id: string,
      body: { representative?: string; reviewed?: boolean; ignored?: boolean },
    ): Promise<boolean> => {
      try {
        await groups.update.mutateAsync({ id, body });
        return true;
      } catch (error) {
        pushToast({
          kind: "error",
          message: `没能保存这个决定：${describeError(error)}`,
        });
        return false;
      }
    },
    [groups, pushToast],
  );

  /**
   * 撤销一次状态写入。
   *
   * 每一组回到自己操作前的那一档：后端记下了每组的原状态，撤销按它
   * 恢复。「已忽略」的组被标记为已处理之后，撤销要回到「已忽略」，
   * 不是回到「待处理」。
   */
  const undoStatus = useCallback(
    async (entries: UndoEntry[]) => {
      if (entries.length === 0) return;
      try {
        const result = await groups.restore.mutateAsync(
          entries.map((entry) => ({
            groupId: entry.groupId,
            from: entry.from,
            to: entry.to,
          })),
        );
        const conflicts = result.conflicts?.length ?? 0;
        if (conflicts > 0) {
          pushToast({
            kind: "warning",
            message: `有 ${conflicts} 组之后又改过，没有恢复`,
          });
          return;
        }
        pushToast({
          kind: "success",
          message: `已恢复 ${result.changed} 组的原状态`,
        });
      } catch (error) {
        pushToast({
          kind: "error",
          message: `没能撤销：${describeUndoError(error)}`,
        });
      }
    },
    [groups, pushToast],
  );

  /**
   * 撤销单组的状态写入。
   *
   * 与批量撤销走不同的路：单组是「这一组之后又改过」还是「恢复了」，
   * 一句话说清；批量则要报出有几组没恢复。
   *
   * 并发校验：写入带上「操作后是哪一档」，用户在这之后又改过这一组
   * 时后端拒写（409），这里如实说「撤销不了」，不谎报恢复成功。
   */
  const undoOne = useCallback(
    async (entry: UndoEntry) => {
      try {
        await groups.update.mutateAsync({
          id: entry.groupId,
          body: { status: entry.to, expectedStatus: entry.from },
        });
        pushToast({ kind: "success", message: "已恢复原状态" });
      } catch (error) {
        pushToast({
          kind: "error",
          message: `没能撤销：${describeUndoError(error)}`,
        });
      }
    },
    [groups, pushToast],
  );

  /**
   * 把某一组设成目标状态，并留一条能精确撤销的提示。
   *
   * 后端在写入前记下了这一组原来的状态（previousStatus）：三档状态
   * 互斥，「标记已处理」会把原来的「已忽略」抹掉，只有记下来才回得去。
   */
  const handleSetStatus = useCallback(
    async (
      group: SimilarityGroup,
      target: SimilarityGroupStatus,
      message: string,
    ) => {
      try {
        const result = await groups.update.mutateAsync({
          id: group.id,
          body: { status: target },
        });
        const entry: UndoEntry = {
          groupId: group.id,
          from: result.status ?? target,
          to: result.previousStatus ?? group.status,
        };
        pushToast({
          kind: "success",
          message,
          ttl: 8000,
          action: {
            label: "撤销",
            onClick: () => void undoOne(entry),
          },
        });
      } catch (error) {
        pushToast({
          kind: "error",
          message: `没能保存这个决定：${describeError(error)}`,
        });
      }
    },
    [groups, pushToast, undoOne],
  );

  /** 标记一组为已处理：说清做了什么，并留一条撤销。 */
  const handleReview = useCallback(
    async (group: SimilarityGroup) => {
      const undo = group.status === "reviewed";
      await handleSetStatus(
        group,
        undo ? "pending" : "reviewed",
        undo ? "已放回待处理" : "已标记 1 组",
      );
    },
    [handleSetStatus],
  );

  /** 忽略一组：同样留一条撤销。 */
  const handleIgnore = useCallback(
    async (group: SimilarityGroup) => {
      const undo = group.status === "ignored";
      await handleSetStatus(
        group,
        undo ? "pending" : "ignored",
        undo ? "已取消忽略" : "已忽略这一组",
      );
    },
    [handleSetStatus],
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
        // 反馈必须说清是哪一件事：一句话里的「处理」既可以是标记处理
        // 也可以是忽略，用户分不清自己刚才点的是哪一个。
        if (action === "pick") {
          pushToast({
            kind: result.changed ? "success" : "info",
            message: result.changed
              ? `已把 ${result.changed} 张代表照片加入精选`
              : "这些代表照片已经在精选里了",
          });
        } else {
          const done = action === "review" || action === "ignore";
          const label =
            action === "review"
              ? "标记为已处理"
              : action === "ignore"
                ? "忽略"
                : action === "unreview"
                  ? "放回待处理"
                  : "取消忽略";
          const message =
            action === "review"
              ? `已把 ${result.changed} 组标记为已处理`
              : action === "ignore"
                ? `已忽略 ${result.changed} 组`
                : action === "unreview"
                  ? `已把 ${result.changed} 组放回待处理`
                  : `已取消忽略 ${result.changed} 组`;
          // 撤销按每组自己的原状态恢复：后端把变了的那几组的原状态
          // 记了下来（previous），这里照着它一条条还原。
          const entries = undoEntriesFrom(result);
          if (result.changed === 0) {
            // 一组都没变：如实说没有可做的事，也不给一条撤销 ——
            // 没有变化就没有可撤销的东西。
            pushToast({
              kind: "info",
              message: `没有组需要${label}`,
            });
          } else {
            pushToast({
              kind: "success",
              message,
              ttl: done ? 8000 : undefined,
              action:
                done && entries.length > 0
                  ? {
                      label: "撤销",
                      onClick: () => void undoStatus(entries),
                    }
                  : undefined,
            });
          }
        }
        setSelectedIds(new Set());
      } catch (error) {
        pushToast({
          kind: "error",
          message: `批量操作没成功：${describeError(error)}`,
        });
      }
    },
    [groups, pushToast, selectedIds, undoStatus],
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
    <div className="similarity-page min-h-full pb-10" ref={bindScrollParent}>
      <Page
        variant="workspace"
        className={
          wide && reviewing
            ? "flex h-[calc(100dvh-var(--topbar-h)-2rem)] flex-col"
            : ""
        }
      >
        <PageHero
          title="相似照片与连拍"
          meta={
            summary && (
              <span data-testid="similarity-summary">
                待处理 {summary.pending} 组 · 可释放 {summary.redundant} 张
              </span>
            )
          }
          actions={
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
                  void queryClient.invalidateQueries({
                    queryKey: ["similarity"],
                  })
                }
              />
            </div>
          }
        />
        <PageToolbar
          label="相似照片筛选"
          start={
            <>
              <Segmented
                label="类型"
                showLabel
                value={kind}
                onChange={(value) => updateParam(KIND_PARAM, value)}
                options={KIND_OPTIONS.map((option) => ({
                  ...option,
                  ariaLabel: option.label,
                  label: (
                    <>
                      {option.label}
                      {summary && option.value && (
                        <small className="ml-1 text-caption tabular-nums">
                          {summary[option.value]}
                        </small>
                      )}
                    </>
                  ),
                }))}
              />
              <Menu
                label="处理状态"
                trigger={
                  <Button variant="secondary">
                    状态：
                    {
                      STATUS_OPTIONS.find((item) => item.value === status)
                        ?.label
                    }
                  </Button>
                }
                items={STATUS_OPTIONS.map((option) => ({
                  id: option.value,
                  label:
                    option.label +
                    (summary && option.value !== "all"
                      ? " " + summary[option.value]
                      : ""),
                  checked: status === option.value,
                  onSelect: () => updateParam(STATUS_PARAM, option.value),
                }))}
              />
              {folders.length > 0 ? (
                <Menu
                  label="按文件夹查看整理结果"
                  trigger={
                    <button type="button" className="btn btn-sm">
                      <FolderIcon size={14} />
                      {folder || "全部文件夹"}
                    </button>
                  }
                  items={[
                    {
                      id: "all",
                      label: "全部文件夹",
                      checked: !folder,
                      onSelect: () => updateParam(FOLDER_PARAM, ""),
                    },
                    ...folders.map((item) => ({
                      id: "folder-" + item.folder,
                      label: item.folder + " " + item.groups,
                      checked: folder === item.folder,
                      onSelect: () => updateParam(FOLDER_PARAM, item.folder),
                    })),
                  ]}
                />
              ) : null}
            </>
          }
          end={
            <>
              <Popover
                trigger={
                  <Button variant="ghost" aria-label="分组说明">
                    ⓘ
                  </Button>
                }
              >
                <div className="max-w-xs space-y-2 p-3 text-caption">
                  <p>完全重复按文件内容判定。</p>
                  <p>近似重复按画面判定。</p>
                  <p>连拍记录同一个瞬间的不同照片。</p>
                  {statusInfo && (
                    <p>
                      {statusInfo.hasVectors
                        ? "语义索引可用，近似判定更准"
                        : "没有语义索引，近似判定已收紧"}
                    </p>
                  )}
                  {groups.page?.limited && (
                    <p>本次召回触到上限，结果可能不完整</p>
                  )}
                </div>
              </Popover>
              <Segmented
                label="查看方式"
                value={view}
                options={[
                  { value: "review", label: "逐组审阅" },
                  { value: "grid", label: "网格" },
                ]}
                onChange={(value) =>
                  changeWorkspace(value === "review" && wide ? null : value)
                }
              />
            </>
          }
        />
        {groups.page?.stale && (
          <InlineAlert tone="warning">分组基于旧的分析结果</InlineAlert>
        )}
        {groups.isError && items.length === 0 ? (
          <ErrorBanner
            className="rounded-xl"
            onRetry={() => void groups.refetch()}
            retrying={groups.isLoading || groups.isFetchingNextPage}
          >
            整理结果暂时读不出来。
          </ErrorBanner>
        ) : groups.isLoading && items.length === 0 ? (
          <p className="py-8 text-center text-caption text-ink-3">
            正在读取整理结果…
          </p>
        ) : isEmpty ? (
          <EmptyState
            title={emptyTitle(statusInfo?.analyzed ?? 0, status)}
            description={emptyDescription(statusInfo?.analyzed ?? 0, status)}
            icon={<span aria-hidden="true">◧</span>}
            size="compact"
            action={
              status === "pending" && statusInfo?.analyzed ? (
                <Button
                  variant="secondary"
                  onClick={() => updateParam(STATUS_PARAM, "reviewed")}
                >
                  查看已处理
                </Button>
              ) : undefined
            }
          />
        ) : reviewing && wide ? (
          <ReviewLayout
            list={<GroupList review={review} />}
            stage={<ReviewStage review={review} />}
          />
        ) : (
          <Virtuoso
            data={items}
            customScrollParent={scrollParent}
            useWindowScroll={!scrollParent}
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
                onToggleExpand={() =>
                  wide
                    ? toggleExpanded(group.id)
                    : changeWorkspace("review", group.id)
                }
                selected={selectedIds.has(group.id)}
                onToggleSelect={() => toggleSelected(group.id)}
                onSetRepresentative={(resourceId) =>
                  void handleUpdate(group.id, { representative: resourceId })
                }
                onReview={() => void handleReview(group)}
                onIgnore={() => void handleIgnore(group)}
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
                ? retryNextPage()
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
              onClick={
                groups.isFetchNextPageError ? retryNextPage : loadMoreGroups
              }
              disabled={groups.isFetchingNextPage}
            >
              {groups.isFetchingNextPage
                ? "正在读取下一批分组…"
                : groups.isFetchNextPageError
                  ? "重试读取下一批分组"
                  : `再显示 60 组（还有 ${Math.max(0, (groups.page?.total ?? items.length) - items.length)} 组）`}
            </button>
          </div>
        ) : null}

        {reviewing && !wide && review.active && (
          <Sheet
            open
            side="right"
            label="逐组审阅"
            className="!w-full !rounded-none"
            onClose={() => changeWorkspace("grid")}
          >
            <Button variant="ghost" onClick={() => changeWorkspace("grid")}>
              返回网格
            </Button>
            <ReviewStage review={review} />
          </Sheet>
        )}
        {reviewing && (
          <FloatingBar
            open={review.state.checked.size > 0}
            label="批量整理"
            summary={`已选 ${review.state.checked.size} 组`}
            onClose={review.clearChecked}
            actions={
              <>
                {(["review", "ignore", "pick"] as const).map((action, i) => (
                  <button
                    key={action}
                    onClick={() => void review.batch(action)}
                  >
                    {["全部标记已处理", "忽略", "代表照片加入精选"][i]}
                  </button>
                ))}
              </>
            }
          />
        )}
        {!reviewing && selectedIds.size > 0 ? (
          <div
            className="similarity-actions sticky bottom-[var(--float-bottom)] z-20 flex items-center gap-2.5 flex-wrap mt-5 py-2.5 px-3.5 rounded-md bg-raised shadow-2 border border-line float-bottom [[data-keyboard]_&]:[translate:0_calc(-1_*_var(--keyboard-inset))]"
            data-testid="similarity-batch-bar"
          >
            <span className="text-caption text-ink-2">
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
              标记已处理
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
      </Page>

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
function emptyTitle(analyzed: number, status: SimilarityStatusOption): string {
  if (analyzed <= 0) return "还没有分析过照片";
  switch (status) {
    case "pending":
      return "待处理的组都处理完了";
    case "reviewed":
      return "还没有处理过的组";
    case "ignored":
      return "没有被忽略的组";
    default:
      return "这个筛选下没有需要整理的照片";
  }
}

/** 空态的说明。 */
function emptyDescription(
  analyzed: number,
  status: SimilarityStatusOption,
): string {
  if (analyzed <= 0) {
    return "点右上角的「分析相似照片」跑一次。它在本机算，不联网也不改动原始文件。";
  }
  switch (status) {
    case "pending":
      return "这批重复与连拍都处理过了。切到「已处理」看看决定了什么，切到「已忽略」把不看的那几组放回来。";
    case "reviewed":
      return "处理过的组会出现在这里。想从别处开始，切到「待处理」。";
    case "ignored":
      return "忽略的组不会打扰你。放回待处理的办法：切到「已忽略」，在那一组上点「取消忽略」。";
    default:
      return "换个类别或文件夹看看，或者点右上角「重算分组」重新算一遍。";
  }
}

/** 把错误说成人话。 */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "未知错误";
}

/**
 * 撤销失败的说法。
 *
 * 撤销有两种失败：状态对不上（用户在这之后又改过这一组）与分组已经
 * 没了（重建后换了 id）。这两种都不是「网络抖了一下」，要说得具体 ——
 * 说清楚为什么撤销不了，用户才知道下一步该做什么。
 */
function describeUndoError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "similarity_status_conflict") {
      return "这一组之后又改过，撤销不了";
    }
    if (error.code === "similarity_group_not_found") {
      return "这一组已经不在了，撤销不了";
    }
  }
  return describeError(error);
}

/**
 * 从批量操作的结果里取出撤销条目。
 *
 * previous 是每组操作前的状态，current 是操作后的状态：撤销要按
 * 「从 current 回到 previous」一条条还原。缺哪一头就不给这一条 ——
 * 没有原状态就没有可恢复的地方。
 */
function undoEntriesFrom(result: {
  previous?: Record<string, SimilarityGroupStatus>;
  current?: Record<string, SimilarityGroupStatus>;
}): UndoEntry[] {
  const entries: UndoEntry[] = [];
  for (const [groupId, to] of Object.entries(result.previous ?? {})) {
    const from = result.current?.[groupId];
    if (!from) continue;
    entries.push({ groupId, from, to });
  }
  return entries;
}
