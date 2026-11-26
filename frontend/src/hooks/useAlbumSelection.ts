import { useCallback, useEffect, useMemo, useRef } from "react";
import type { LibraryMediaItem } from "../api/library";
import { usePicks } from "./usePicks";
import { useUIStore } from "../store/uiStore";
import {
  usePhotoSelectionStore,
  MAX_SELECTION,
  type PhotoSelectionEntry,
} from "../store/photoSelectionStore";

type WallItem = LibraryMediaItem & { albumId?: string; albumName?: string };
interface Options {
  items?: readonly WallItem[];
  scope?: string;
  /** 相册 id：选择的作用域是这一本。 */
  albumId: string;
  /** 相册名：写进选择条目，并排对比时用得上。 */
  albumName: string;
}

export interface AlbumSelection {
  /** 是否处于多选模式。 */
  active: boolean;
  /** 提交中：期间不允许再次改动选择。 */
  busy: boolean;
  /** 已选中的条目。 */
  entries: PhotoSelectionEntry[];
  /** 已选中的条目里，有几张在精选里。 */
  pickedCount: number;
  /** 这张照片是不是选中了。 */
  isSelected: (id: string) => boolean;
  /** 勾选 / 取消勾选一张。 */
  toggle: (item: WallItem, range?: boolean) => void;
  /** 进出多选模式。 */
  toggleMode: () => void;
  /** 把选中的照片加入精选。 */
  addToPicks: () => void;
  /** 把选中的照片移出精选。 */
  removeFromPicks: () => void;
}

/**
 * 相册页的多选与精选。
 *
 * 多选是浏览工具：勾几张、比较一下、批量加入精选。它是临时的 ——
 * 换一本相册选择就清空，刷新页面也不留。用户在这本相册里勾的东西，
 * 不会因为换了一种看法（分组、筛选）就丢掉。
 */
export function useAlbumSelection({
  albumId,
  albumName,
  items,
  scope = "album:" + albumId,
}: Options): AlbumSelection {
  const pushToast = useUIStore((s) => s.pushToast);
  const { isPicked, add: addPicks, remove: removePicks } = usePicks();

  // 多选：作用域是这一本相册，换一本相册选择就清空。
  const anchor = useRef<string | null>(null);
  const entries = usePhotoSelectionStore((s) => s.entries);
  const active = usePhotoSelectionStore((s) => s.active);
  const busy = usePhotoSelectionStore((s) => s.busy);
  useEffect(() => {
    usePhotoSelectionStore.getState().ensureScope(scope);
    anchor.current = null;
  }, [scope]);

  const selectedEntries = useMemo(() => Object.values(entries), [entries]);
  const pickedCount = useMemo(
    () => selectedEntries.filter((entry) => isPicked(entry.id)).length,
    [isPicked, selectedEntries],
  );

  const toEntry = useCallback(
    (item: WallItem): PhotoSelectionEntry => ({
      id: item.id,
      name: item.name,
      albumId: item.albumId ?? albumId,
      albumName: item.albumName ?? albumName,
      kind: item.kind,
      version: item.version,
      width: item.width,
      height: item.height,
    }),
    [albumId, albumName],
  );

  const selectRange = useCallback(
    (range: readonly WallItem[]) => {
      const state = usePhotoSelectionStore.getState();
      if (state.busy) return;
      const room = MAX_SELECTION - Object.keys(state.entries).length;
      const incoming = range.filter((item) => !state.entries[item.id]);
      state.selectMany(incoming.slice(0, room).map(toEntry));
      if (incoming.length > room)
        pushToast({ kind: "info", message: "已达到 2,000 张选择上限" });
    },
    [pushToast, toEntry],
  );
  const toggle = useCallback(
    (item: WallItem, range = false) => {
      const state = usePhotoSelectionStore.getState();
      if (state.busy) return;
      if (!state.active) state.start();
      const first =
        items?.findIndex((candidate) => candidate.id === anchor.current) ?? -1;
      const last =
        items?.findIndex((candidate) => candidate.id === item.id) ?? -1;
      anchor.current = item.id;
      if (range && items && first >= 0 && last >= 0)
        selectRange(
          items.slice(Math.min(first, last), Math.max(first, last) + 1),
        );
      else if (!state.toggle(toEntry(item)))
        pushToast({ kind: "info", message: "最多选择 2,000 张，请减少范围" });
    },
    [items, pushToast, selectRange, toEntry],
  );

  useEffect(() => {
    if (!active || !items) return;
    function selectLoaded(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.key.toLowerCase() !== "a" ||
        document.querySelector("dialog[open]")
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target.closest("input,textarea,select"))
      )
        return;
      event.preventDefault();
      selectRange(items ?? []);
    }
    document.addEventListener("keydown", selectLoaded);
    return () => document.removeEventListener("keydown", selectLoaded);
  }, [active, items, selectRange]);

  const isSelected = useCallback(
    (id: string) => Boolean(entries[id]),
    [entries],
  );

  const toggleMode = useCallback(() => {
    // 同一个按钮进出多选：再按一次就退出，
    // 不必另找一个「退出」的入口。
    const state = usePhotoSelectionStore.getState();
    if (state.active) state.clear();
    else state.start();
  }, []);

  // 提交期间锁住选择：连按两下「加入精选」不必发两次请求。
  const runPickAction = useCallback(
    (action: "add" | "remove") => {
      const state = usePhotoSelectionStore.getState();
      if (state.busy) return;
      const ids = Object.values(state.entries).map((entry) => entry.id);
      if (ids.length === 0) return;
      state.setBusy(true);
      const write = action === "add" ? addPicks(ids) : removePicks(ids);
      void write
        .then(() =>
          pushToast({
            kind: "success",
            message:
              action === "add"
                ? `已把 ${ids.length} 张加入精选`
                : `已把 ${ids.length} 张移出精选`,
          }),
        )
        .catch(() =>
          pushToast({
            kind: "error",
            message: action === "add" ? "加入精选失败" : "移出精选失败",
          }),
        )
        .finally(() => usePhotoSelectionStore.getState().setBusy(false));
    },
    [addPicks, pushToast, removePicks],
  );

  return {
    active,
    busy,
    entries: selectedEntries,
    pickedCount,
    isSelected,
    toggle,
    toggleMode,
    addToPicks: useCallback(() => runPickAction("add"), [runPickAction]),
    removeFromPicks: useCallback(
      () => runPickAction("remove"),
      [runPickAction],
    ),
  };
}
