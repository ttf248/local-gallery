import { useUIStore } from "../../store/uiStore";
import { isCompleted, isUnread, progressPercent } from "../../utils/progress";
import { comicCopy } from "../../utils/workbench";
import { mediaCountParts, type MediaCountParts } from "../../utils/mediaCount";
import type { CardData } from "./AlbumTile";

export interface CardState {
  /** 阅读进度百分比（0-100）；没有进度时为 null。 */
  progressPct: number | null;
  /** 0-based 页码到达末页即已读完。 */
  isFinished: boolean;
  /** 阅读进度只属于漫画相册：照片相册没有进度条、没有「已读完」。 */
  isComicAlbum: boolean;
  /** 漫画侧措辞（页 / 卷 / 已读完…）。 */
  cardCopy: ReturnType<typeof comicCopy>;
  /** 未读标记是否出现。 */
  unread: boolean;
  /** 是否配置了多个媒体根：单根下每张卡都挂来源是噪音。 */
  multiRoot: boolean;
  /** 视频时长是否已知：未知时不显示数字（破折号像「读不出来」）。 */
  hasDuration: boolean;
  /** 卡片标题（多根冲突时用处理后的名字）。 */
  label: string;
  /** 作品名：漫画相册的卷名只写「第1卷」，得补上它属于哪部作品。 */
  series: string | undefined;
  /** 卡片底部的「X 张 · Y 个视频」。非相册变体为 null。 */
  counts: MediaCountParts | null;
}

/**
 * 卡片状态的唯一推导。
 *
 * 网格卡与列表卡是同一张卡的两种排法：进度、是否读完、未读标记、计数
 * 与作品名在两边都各算一遍，改了一处忘了另一处，两种视图就会说出
 * 不一样的数字。这里算一次，两边都用同一份。
 */
export function useCardState(
  data: CardData,
  showUnreadBadge: boolean,
): CardState {
  const label = data.displayTitle ?? data.title;
  const isComicAlbum = data.variant === "album" && data.contentKind === "comic";
  return {
    progressPct: progressPercent(data.progress),
    isFinished: isCompleted(data.progress),
    isComicAlbum,
    cardCopy: comicCopy(),
    unread: showUnreadMark(data, showUnreadBadge),
    multiRoot: useUIStore((s) => s.multiRoot),
    hasDuration:
      typeof data.durationSec === "number" &&
      Number.isFinite(data.durationSec) &&
      data.durationSec >= 0,
    label,
    series:
      data.variant === "album" &&
      data.contentKind === "comic" &&
      data.parentName &&
      data.parentName !== label
        ? data.parentName
        : undefined,
    counts: data.variant === "album" ? mediaCountParts(data) : null,
  };
}

/** 未读标记：只对漫画相册、且页面不是「整页未读」时出现。 */
export function showUnreadMark(
  data: CardData,
  showUnreadBadge: boolean,
): boolean {
  if (!showUnreadBadge) return false;
  if (data.variant !== "album") return false;
  if (data.contentKind !== "comic") return false;
  return isUnread(data.progress);
}

/**
 * 卡片打开的是什么东西。
 *
 * 照片侧的文件夹是磁盘上真实存在的目录，叫「文件夹」；漫画侧的集合叫
 * 「作品」。相册两侧都叫「相册」—— 那句提示语是用户读得懂的日常词，
 * 不跟着工作台换。
 */
export function openTargetWord(data: CardData): string {
  if (data.variant === "album") return "相册";
  if (data.variant === "collection")
    return data.contentKind === "comic" ? "作品" : "文件夹";
  return "智能视图";
}
