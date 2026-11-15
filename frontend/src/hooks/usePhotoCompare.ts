import { useCallback, useState } from "react";
import type { CompareItem } from "../components/wall/PhotoCompare";
import { usePhotoSelectionStore } from "../store/photoSelectionStore";
import type { WallViewerItem } from "./useWallViewer";

interface CompareState {
  /** 待对比的那一张。 */
  pin: CompareItem | null;
  /** 并排打开的那一对。 */
  pair: [CompareItem, CompareItem] | null;
}

/**
 * 并排对比：先放一张进「待对比」，再对另一张按 C 就并排打开。
 *
 * 相册墙与精选墙各自写了一份这套状态：钉一张、再钉一张成对、左右
 * 互换、关掉。写两份的结果是两边的手感可能不一样 —— 收在这里，
 * 两处用的是同一套规则。
 */
export function usePhotoCompare<T extends WallViewerItem>(
  albumNameOf: (item: T) => string,
) {
  const [state, setState] = useState<CompareState>({ pin: null, pair: null });

  const togglePin = useCallback(
    (item: T) => {
      // 视频没有可并排的画面：对比只对图片开放。
      if (item.kind === "video") return;
      const current: CompareItem = {
        id: item.id,
        name: item.name,
        version: item.version,
        width: item.width,
        height: item.height,
        albumName: albumNameOf(item),
      };
      setState((prev) => {
        // 已经有待对比的那一张时再钉一张，就是把它们并排打开。
        if (prev.pin && prev.pin.id !== current.id) {
          return { pin: null, pair: [prev.pin, current] };
        }
        // 钉同一张：取消。
        return { pin: prev.pin ? null : current, pair: prev.pair };
      });
    },
    [albumNameOf],
  );

  /** 把多选里的那两张并排打开。 */
  const compareSelected = useCallback(() => {
    const entries = Object.values(usePhotoSelectionStore.getState().entries);
    if (entries.length !== 2) return;
    const [left, right] = entries;
    const toItem = (entry: (typeof entries)[number]): CompareItem => ({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      width: entry.width,
      height: entry.height,
      albumName: entry.albumName ?? "",
    });
    setState((prev) => ({ pin: prev.pin, pair: [toItem(left), toItem(right)] }));
  }, []);

  /** 左右互换。 */
  const swap = useCallback(() => {
    setState((prev) =>
      prev.pair ? { pin: prev.pin, pair: [prev.pair[1], prev.pair[0]] } : prev,
    );
  }, []);

  /** 关掉并排对比。 */
  const close = useCallback(() => {
    setState((prev) => ({ pin: prev.pin, pair: null }));
  }, []);

  return {
    pin: state.pin,
    pair: state.pair,
    togglePin,
    compareSelected,
    swap,
    close,
  };
}
