import { api } from "./client";

/**
 * 自动发现文件变化的状态。
 *
 * 后端监听媒体根，文件新增、删除、移动后增量更新图库；
 * 这个结构描述开关、监听情况与最近一次同步的结果。
 */
export interface LibrarySyncStatus {
  /** 是否打开自动发现文件变化。 */
  enabled: boolean;
  /** 图库更新后是否自动为变动的照片排分析任务。 */
  autoAnalyze: boolean;
  /** 监听器是否正在接收事件。 */
  running: boolean;
  /** 监听是否不可靠（溢出、权限不足、网络共享），此时靠定期校验兜底。 */
  degraded: boolean;
  /** 已接管的媒体根数量。 */
  watchedRoots: number;
  /** 当前登记的监听目录数量。 */
  watchedDirs: number;
  /** 监听目录数量上限。 */
  maxWatchDirs: number;
  /** 已收到但还没合并进图库的变化条目数。 */
  pendingChanges: number;
  /** 已排队等待分析的资源数量。 */
  pendingAnalysis: number;
  lastEventAt?: string;
  lastVerifyAt?: string;
  lastSyncAt?: string;
  /** 上次同步检测到的变化条目数。 */
  lastDetected: number;
  /** 上次同步真正改动索引的资源数量。 */
  lastUpdated: number;
  /** 上次同步里没能读取的目录数量。 */
  lastFailed: number;
  /** 最近一次失败的机器可读原因。 */
  lastError?: string;
  /** 当前图库版本；图库一变它就变。 */
  libraryRevision: number;
}

/** PUT /api/library-sync 的请求体：缺省表示「不改」。 */
export interface LibrarySyncPatch {
  enabled?: boolean;
  autoAnalyze?: boolean;
}

export const librarySyncApi = {
  status: (signal?: AbortSignal) =>
    api<LibrarySyncStatus>("/api/library-sync", { signal, cache: "no-store" }),
  update: (patch: LibrarySyncPatch) =>
    api<LibrarySyncStatus>("/api/library-sync", { method: "PUT", body: patch }),
};

/** 自动同步状态的查询键。设置页与应用常驻层共用这一份缓存。 */
export const librarySyncQueryKey = ["library-sync"] as const;

/**
 * 把后端的失败原因翻译成中文。
 *
 * 后端只给机器可读的码（跟扫描错误的处理方式一致），文案在前端写。
 */
export function describeSyncError(code?: string): string {
  switch (code) {
    case "event_overflow":
      return "文件事件溢出，已改用定期校验";
    case "watch_failed":
      return "监听出错，已改用定期校验";
    case "watcher_start_failed":
      return "无法启动监听，请检查目录权限";
    case "incremental_failed":
      return "增量更新失败，图库保持上一次的结果";
    case "verification_failed":
      return "定期校验失败";
    default:
      return "";
  }
}
