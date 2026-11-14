import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { historyApi } from "../api/prefs";
import { syncHistoryCache } from "../utils/historyCache";

/**
 * 同一本相册在一段时间内只记一次（秒）。
 *
 * 翻照片时相册会换来换去：每一张都写一遍偏好文件，写盘次数跟着照片数
 * 走，而最近页里那一条并没有变得更「最近」。
 */
export const VISIT_COOLDOWN_MS = 30_000;

/** 每本相册上次被记下的时刻。 */
const lastRecorded = new Map<string, number>();

export interface VisitInfo {
  /** 相册名。写进历史里做兜底：页面上的名字仍取自媒体库摘要。 */
  name?: string;
  /** 媒体数。同上，只作兜底。 */
  imageCount?: number;
}

export interface VisitOptions {
  /**
   * 冷却时长（毫秒）。0 表示这次一定要记下来。
   *
   * 打开相册页总是要记：用户刚打开的这本就该排在最前，哪怕几十秒前
   * 刚看过同一本。看照片走冷却：连着翻同一本里的十几张照片，写十几次
   * 偏好文件并不会让最近页更准。
   */
  cooldownMs?: number;
}

/**
 * 记一次「我看过这本相册里的东西」。
 *
 * 照片侧的最近浏览记到相册，不记到单张照片：照片侧没有阅读位置，
 * 回到相册就是回到那本相册。用户翻的是照片，落点却是相册 —— 这条
 * 记录回答的是「我刚才在翻哪本相册」。
 */
export function useVisitRecorder() {
  const queryClient = useQueryClient();
  return useCallback(
    (albumId: string, info?: VisitInfo, options?: VisitOptions) => {
      if (!albumId) return;
      const now = Date.now();
      const cooldown = options?.cooldownMs ?? 0;
      if (cooldown > 0) {
        const last = lastRecorded.get(albumId) ?? 0;
        if (now - last < cooldown) return;
      }
      lastRecorded.set(albumId, now);
      void historyApi
        .add({
          albumId,
          name: info?.name ?? "",
          imageCount: info?.imageCount ?? 0,
        })
        .then(({ history }) => syncHistoryCache(queryClient, history))
        .catch(() => {});
    },
    [queryClient],
  );
}

/**
 * 清空冷却记录（只给测试用）。
 *
 * 冷却表是模块级的：同一个进程里它跨组件活着，用例之间不清干净，
 * 第二条用例就会因为第一条刚记过而什么都不写。
 */
export function resetVisitRecorder(): void {
  lastRecorded.clear();
}
