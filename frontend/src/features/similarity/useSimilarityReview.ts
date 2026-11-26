import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  SimilarityBatchAction,
  SimilarityGroupQuery,
  SimilarityRestoreEntry,
  SimilarityGroupStatus,
} from "../../api/similarity";
import { picksApi } from "../../api/picks";
import { useSimilarityGroups } from "../../hooks/useSimilarity";
import { useUIStore } from "../../store/uiStore";
import {
  clampMemberIndex,
  nextActiveAfterRemoval,
  shouldPrefetch,
} from "./reviewNavigation";

type Undo = { label: string; entries: SimilarityRestoreEntry[] };
type ReviewURL = {
  groupId: string | null;
  replaceGroupId: (id: string | null) => void;
  enabled?: boolean;
};

export function useSimilarityReview(
  query: SimilarityGroupQuery,
  url: ReviewURL,
) {
  const source = useSimilarityGroups(query);
  const client = useQueryClient();
  const toast = useUIStore((state) => state.pushToast);
  const groups = source.groups;
  const active =
    groups.find((group) => group.id === url.groupId) ?? groups[0] ?? null;
  const activeId = active?.id ?? null;
  const [member, setMember] = useState({ id: activeId, index: 0 });
  const focusIndex = clampMemberIndex(
    member.id === activeId ? member.index : 0,
    active?.members.length ?? 0,
  );
  const setFocus = (index: number) =>
    setMember({
      id: activeId,
      index: clampMemberIndex(index, active?.members.length ?? 0),
    });
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [lastUndo, setLastUndo] = useState<Undo | null>(null);
  const locks = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const latest = useRef(url);
  latest.current = url;
  const index = groups.findIndex((group) => group.id === activeId);
  const notice = useRef<string | null>(null);
  useEffect(() => {
    if (url.groupId && locks.current.has(url.groupId)) return;
    if (
      url.enabled === false ||
      source.isLoading ||
      source.isError ||
      url.groupId === activeId
    )
      return;
    if (url.groupId && notice.current !== url.groupId) {
      toast({
        kind: "info",
        message: activeId ? "这一组已不存在，已跳到下一组" : "这一组已不存在",
      });
      notice.current = url.groupId;
    }
    url.replaceGroupId(activeId);
  }, [url, activeId, source.isLoading, source.isError, pending, toast]);
  useEffect(() => {
    anchor.current = null;
    setChecked(new Set());
  }, [query.folder, query.kind, query.status]);
  const {
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = source;
  useEffect(() => {
    if (
      url.enabled !== false &&
      !isFetchNextPageError &&
      !isFetchingNextPage &&
      shouldPrefetch(index, groups.length, Boolean(hasNextPage))
    ) {
      void fetchNextPage({ cancelRefetch: false });
    }
  }, [
    index,
    groups.length,
    url.enabled,
    hasNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
    fetchNextPage,
  ]);
  function select(id: string) {
    if (!groups.some((group) => group.id === id)) return;
    latest.current = { ...latest.current, groupId: id };
    latest.current.replaceGroupId(id);
  }
  function step(delta: number) {
    const group = groups[index + delta];
    if (group) select(group.id);
  }
  function toggleChecked(id: string, range = false) {
    const from = groups.findIndex((group) => group.id === anchor.current);
    const to = groups.findIndex((group) => group.id === id);
    anchor.current = id;
    setChecked((previous) => {
      const next = new Set(previous);
      if (range && from >= 0 && to >= 0) {
        for (const group of groups.slice(
          Math.min(from, to),
          Math.max(from, to) + 1,
        ))
          next.add(group.id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function transact(ids: string[], operation: () => Promise<void>) {
    if (!ids.length || ids.some((id) => locks.current.has(id))) return;
    ids.forEach((id) => locks.current.add(id));
    setPending(new Set(locks.current));
    try {
      await operation();
    } catch {
      toast({
        kind: "error",
        message: "未能保存这个决定",
        action: { label: "重试", onClick: () => void transact(ids, operation) },
      });
    } finally {
      ids.forEach((id) => locks.current.delete(id));
      setPending(new Set(locks.current));
    }
  }
  async function restore(decision: Undo) {
    await transact(
      decision.entries.map((entry) => entry.groupId),
      async () => {
        const result = await source.restore.mutateAsync(decision.entries);
        setLastUndo((current) => (current === decision ? null : current));
        if (result.changed) {
          await source.refetch();
          const restored = decision.entries.find(
            (entry) => !result.conflicts?.includes(entry.groupId),
          );
          if (restored && (!query.status || query.status === restored.to))
            latest.current.replaceGroupId(restored.groupId);
        }
        toast({
          kind: result.conflicts?.length ? "warning" : "success",
          message: `已恢复 ${result.changed} 组的原状态`,
        });
      },
    );
  }
  function remember(label: string, entries: SimilarityRestoreEntry[]) {
    if (!entries.length) return;
    const decision = { label, entries };
    setLastUndo(decision);
    toast({
      kind: "success",
      message: label,
      ttl: 8000,
      action: { label: "撤销", onClick: () => void restore(decision) },
    });
  }
  async function decide(status: SimilarityGroupStatus) {
    if (!active) return;
    const { id } = active;
    await transact([id], async () => {
      const result = await source.update.mutateAsync({
        id,
        body: { status, expectedStatus: active.status },
      });
      if (result.changed === false) return;
      remember(status === "reviewed" ? "已标记 1 组为已处理" : "已忽略 1 组", [
        {
          groupId: id,
          from: result.status ?? status,
          to: result.previousStatus ?? active.status,
        },
      ]);
      if (
        latest.current.groupId === id &&
        query.status &&
        query.status !== status
      )
        latest.current.replaceGroupId(
          nextActiveAfterRemoval(
            groups.map((group) => group.id),
            id,
          ),
        );
    });
  }
  async function batch(action: SimilarityBatchAction) {
    const ids = [...checked];
    await transact(ids, async () => {
      const result = await source.batch.mutateAsync({ groupIds: ids, action });
      setChecked(
        (previous) => new Set([...previous].filter((id) => !ids.includes(id))),
      );
      if (action === "pick") {
        await client.invalidateQueries({ queryKey: ["picks"] });
        toast({ kind: "success", message: `已加入精选 ${result.changed} 张` });
        return;
      }
      const entries: SimilarityRestoreEntry[] = [];
      for (const [groupId, to] of Object.entries(result.previous ?? {})) {
        const from = result.current?.[groupId];
        if (from) entries.push({ groupId, to, from });
      }
      remember(
        action === "ignore"
          ? `已忽略 ${result.changed} 组`
          : `已把 ${result.changed} 组标记为已处理`,
        entries,
      );
      if (
        activeId &&
        latest.current.groupId === activeId &&
        ids.includes(activeId) &&
        query.status
      )
        latest.current.replaceGroupId(
          groups.find((group) => !checked.has(group.id))?.id ?? null,
        );
    });
  }
  async function setRepresentative(memberIndex: number) {
    const target = active?.members[memberIndex];
    if (!active || !target) return;
    await transact([active.id], async () => {
      await source.update.mutateAsync({
        id: active.id,
        body: { representative: target.resourceId },
      });
      if (latest.current.groupId === active.id) setFocus(memberIndex);
    });
  }
  async function addPick() {
    if (!active || !active.members[focusIndex]) return;
    const id = active.members[focusIndex].resourceId;
    await transact([active.id], async () => {
      await picksApi.batch([id], "add");
      await client.invalidateQueries({ queryKey: ["picks"] });
      toast({ kind: "success", message: "已加入精选" });
    });
  }
  return {
    source,
    active,
    state: { groups, activeId, focusIndex, checked, pending, lastUndo },
    select,
    next: () => step(1),
    prev: () => step(-1),
    setFocus,
    focusMember: (delta: -1 | 1) => setFocus(focusIndex + delta),
    markReviewed: () => decide("reviewed"),
    ignore: () => decide("ignored"),
    setRepresentative,
    addPick,
    undo: async () => {
      if (lastUndo) await restore(lastUndo);
    },
    toggleChecked,
    clearChecked: () => setChecked(new Set()),
    batch,
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage)
        void fetchNextPage({ cancelRefetch: false });
    },
  };
}
export type SimilarityReview = ReturnType<typeof useSimilarityReview>;
export type SimilarityReviewState = SimilarityReview["state"];
