import {buttonStyles} from "../../ui/buttonStyles";
import { SelectionBar } from "./SelectionBar";
import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { favoritesApi } from "../../api/prefs";
import { favoritesQueryKey } from "../../api/queryKeys";
import { activityApi } from "../../api/activity";
import { libraryApi } from "../../api/library";
import { ApiError } from "../../api/client";
import {
  useSelectionStore,
  type SelectionItem,
} from "../../store/selectionStore";
import { useUIStore } from "../../store/uiStore";
import { useAppMode } from "../../hooks/useAppMode";

interface Props {
  loaded: SelectionItem[];
}

/**
 * 「选择」入口：进入批量选择模式。
 *
 * 它挂在列表页工具条的最右端（ListFilterBar 的 trailing 槽），不再
 * 单独占一整行浮在网格上方 —— 一排列表页顶部只留一行控件，那枚
 * 孤零零的按钮读起来像网格的一部分。
 *
 * 进入选择模式后这个按钮消失：工具条右端换成一整排批量动作
 * （BulkActions），位置不变，动作不换地方。
 */
export function SelectionToggle() {
  const active = useSelectionStore((s) => s.active);
  const busy = useSelectionStore((s) => s.busy);
  if (active) return null;
  return (
    <button
      className={buttonStyles({variant:"secondary",size:"sm"})}
      disabled={busy}
      onClick={() => useSelectionStore.getState().start()}
    >
      选择
    </button>
  );
}

export default function LibrarySelectionActions({ loaded }: Props) {
  const client = useQueryClient();
  const errorToast = useRef<string>();
  const { mode } = useAppMode();
  const active = useSelectionStore((s) => s.active);
  const selected = useSelectionStore((s) => s.items);
  const busy = useSelectionStore((s) => s.busy);
  const count = Object.keys(selected).length;
  const readable = Object.values(selected).filter(
    (item) =>
      item.albumId && item.contentKind === "comic" && item.imageCount > 0,
  );
  const toast = useUIStore((s) => s.pushToast);

  async function execute(action: "add" | "remove" | "read" | "unread") {
    const state = useSelectionStore.getState();
    if (state.busy) return;
    if (errorToast.current)
      useUIStore.getState().dismissToast(errorToast.current);
    errorToast.current = undefined;
    const snapshot = Object.values(state.items);
    if (!snapshot.length) return;
    useSelectionStore.setState({ busy: true });
    try {
      if (action === "add" || action === "remove") {
        const saved = await favoritesApi.batch(
          snapshot.map((item) => item.id),
          action,
        );
        client.setQueryData(favoritesQueryKey, { favorites: saved.favorites });
        void client.invalidateQueries({ queryKey: favoritesQueryKey });
      } else {
        const candidates = snapshot.filter(
          (item) =>
            item.albumId && item.contentKind === "comic" && item.imageCount > 0,
        );
        const nodes = await libraryApi.queryNodes(
          candidates.map((item) => item.albumId!),
        );
        if (
          nodes.missing.length ||
          nodes.items.length !== candidates.length ||
          nodes.items.some(
            (node) =>
              node.kind !== "album" ||
              node.contentKind !== "comic" ||
              !(node.imageCount! > 0),
          )
        )
          throw new Error("所选相册已变化，请刷新列表后重试");
        if (action === "read")
          await activityApi.setBatch(
            nodes.items.map((node) => ({
              albumId: node.id,
              mediaKind: "image",
              pageIndex: node.imageCount! - 1,
              pageCount: node.imageCount!,
            })),
          );
        else await activityApi.removeImages(nodes.items.map((node) => node.id));
        await client.invalidateQueries({
          predicate: (query) =>
            ["activity", "activity-query", "library"].includes(
              String(query.queryKey[0]),
            ),
        });
      }
      useSelectionStore.getState().finish(state.scope);
      toast({ kind: "success", message: "批量操作已完成" });
    } catch (error: unknown) {
      useSelectionStore.setState({ busy: false });
      errorToast.current = toast({
        kind: "error",
        message:
          error instanceof ApiError && error.code === "favorite_limit"
            ? "收藏最多保留 500 项，请先整理已有收藏。"
            : error instanceof ApiError
              ? "批量操作失败，请重试。"
              : error instanceof Error
                ? error.message
                : "批量操作失败，请重试。",
      });
    }
  }

  function selectLoaded() {
    if (!useSelectionStore.getState().selectLoaded(loaded))
      toast({ kind: "info", message: "最多选择 1,000 项，请减少选择范围。" });
  }
  if (!active) return null;
  return (
    <SelectionBar
      active
      count={count}
      noun="项"
      busy={busy}
      label="批量操作"
      detail={mode === "comic" ? readable.length + " 卷可标记" : undefined}
      onSelectLoaded={selectLoaded}
      onExit={() => useSelectionStore.getState().clear()}
      actions={[
        {
          id: "loaded",
          label: "选择已加载项",
          title: "选择已加载的 " + loaded.length + " 项",
          onRun: selectLoaded,
        },
        {
          id: "favorite",
          label: "批量收藏",
          disabled: !count,
          onRun: () => execute("add"),
        },
        {
          id: "unfavorite",
          label: "批量取消收藏",
          disabled: !count,
          onRun: () => execute("remove"),
        },
        ...(mode === "comic"
          ? [
              {
                id: "read",
                label: "标记已读",
                disabled: !readable.length,
                onRun: () => execute("read"),
              },
              {
                id: "unread",
                label: "重置未读",
                disabled: !readable.length,
                onRun: () => execute("unread"),
              },
            ]
          : []),
      ]}
    />
  );
}
