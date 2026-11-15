import { api } from "./client";
import type {
  AppMode,
  ContentKind,
  LibraryMediaItem,
  LibraryPage,
} from "./library";

export type SmartAlbumDimension = "time" | "place" | "people" | "scene";
export type SmartAlbumDirectoryDimension = "all" | SmartAlbumDimension;

/** 智能相册刷新的任务状态，与缓存重建同一套取值。 */
export type SmartAlbumRefreshStatus =
  | "pending"
  | "running"
  | "complete"
  | "cancelled"
  | "error";

/** 全库智能相册刷新的进度快照。 */
export interface SmartAlbumRefreshProgress {
  jobId: string;
  status: SmartAlbumRefreshStatus;
  /** 为真时无视缓存，全部重算。 */
  force: boolean;
  /** 照片相册总数；total 是「相册 × 四个维度」的组合总数。 */
  albums: number;
  total: number;
  done: number;
  /** 重算的组合数；reused 是命中缓存直接复用的组合数。 */
  rebuilt: number;
  reused: number;
  /** 本次产出的分组总数。 */
  groups: number;
  currentAlbumId?: string;
  currentAlbumName?: string;
  currentDimension?: string;
  /** 任务的开始与结束时间（ISO 字符串）。 */
  startedAt?: string;
  finishedAt?: string;
  elapsedMs: number;
  /** 失败时的机器可读错误码。 */
  error?: string;
}

export interface SmartAlbumGroup {
  id: string;
  dimension: SmartAlbumDimension;
  name: string;
  suggestedName: string;
  customName: boolean;
  photoCount: number;
  coverResourceId?: string;
  coverVersion?: string;
  hidden: boolean;
}

export interface SmartAlbumCoverage {
  module: string;
  total: number;
  analyzed: number;
  missing: number;
  failed: number;
  withEvidence: number;
  available: boolean;
  reason?: string;
}

export interface SmartAlbumSummary {
  albumId: string;
  dimension: SmartAlbumDimension;
  revision: number;
  snapshotKey: string;
  totalPhotos: number;
  availablePhotos: number;
  unavailablePhotos: number;
  ungroupedPhotos: number;
  hiddenGroupCount: number;
  coverage: SmartAlbumCoverage;
  groups: SmartAlbumGroup[];
  cacheHit: boolean;
}

export interface SmartAlbumDirectoryItem {
  albumId: string;
  albumName: string;
  parentName?: string;
  group: SmartAlbumGroup;
}

export type SmartAlbumDirectoryPage = LibraryPage<SmartAlbumDirectoryItem>;

export interface SmartAlbumOverride {
  name?: string;
  hidden?: boolean;
}

export interface SearchHit {
  kind: "album" | "collection" | "smartCollection";
  path: string;
  name: string;
  /** 散图（"本目录媒体"）：name 是归属目录路径，与同名集合区分靠这个标记。 */
  virtual?: boolean;
  tags?: string[];
  count: number;
  coverImage?: string;
  /** 封面内容版本号，用于拼出版本化 URL 让浏览器长期缓存。 */
  coverImageVersion?: string;
  /** 内容用途："photo" / "comic"。搜索结果据此决定跳转目标。 */
  contentKind?: ContentKind;
}

export const albumsApi = {
  /**
   * 全局搜索。kind 必填：媒体库按目录属性一分为二，
   * 搜索结果只呈现当前这一侧，给个默认值只会静默搜错模式。
   */
  search(q: string, kind: AppMode, limit = 50) {
    return api<{ ok: boolean; results: SearchHit[]; count: number }>(
      `/api/search`,
      {
        params: { q, limit, kind },
      },
    );
  },
  smartDirectory(
    dimension: SmartAlbumDirectoryDimension,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    return api<{ ok: boolean; page: SmartAlbumDirectoryPage }>(
      "/api/smart-albums",
      { params: { dimension, cursor, limit: 60 }, signal },
    );
  },
  // 自定义封面：把 file 设为 album path 的封面（持久化到 cover_overrides.json）。
  // 成功后调用方失效媒体库摘要，即可看到新封面。
  setCover(albumId: string, file: string) {
    return api<{
      ok: boolean;
      albumPath: string;
      coverImage: string;
      coverKind: string;
    }>(`/api/albums/${encodeURIComponent(albumId)}/cover`, {
      method: "PUT",
      params: { file },
    });
  },
  // 清除自定义封面：回退到扫描器默认（images[0]，否则 videos[0]）。
  clearCover(albumId: string) {
    return api<{ ok: boolean; albumPath: string }>(
      `/api/albums/${encodeURIComponent(albumId)}/cover`,
      {
        method: "DELETE",
      },
    );
  },
  smartGroups(
    albumId: string,
    dimension: SmartAlbumDimension,
    signal?: AbortSignal,
  ) {
    return api<{ ok: boolean; summary: SmartAlbumSummary }>(
      `/api/albums/${encodeURIComponent(albumId)}/smart-groups`,
      { params: { dimension }, signal },
    );
  },
  rebuildSmartGroups(albumId: string, dimension: SmartAlbumDimension) {
    return api<{ ok: boolean; summary: SmartAlbumSummary }>(
      `/api/albums/${encodeURIComponent(albumId)}/smart-groups/rebuild`,
      { method: "POST", params: { dimension } },
    );
  },
  updateSmartGroup(
    albumId: string,
    dimension: SmartAlbumDimension,
    groupId: string,
    override: SmartAlbumOverride,
  ) {
    return api<{ ok: boolean; summary: SmartAlbumSummary }>(
      `/api/albums/${encodeURIComponent(albumId)}/smart-groups/${encodeURIComponent(groupId)}`,
      { method: "PUT", params: { dimension }, body: override },
    );
  },
  smartGroupMedia(
    albumId: string,
    dimension: SmartAlbumDimension,
    groupId: string,
    snapshot: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    return api<{ ok: boolean; page: LibraryPage<LibraryMediaItem> }>(
      `/api/albums/${encodeURIComponent(albumId)}/smart-groups/${encodeURIComponent(groupId)}/media`,
      { params: { dimension, snapshot, cursor, limit: 200 }, signal },
    );
  },
  // 全库刷新：后台任务，返回任务号，进度与取消另有接口。
  startSmartAlbumRefresh(force = false) {
    return api<{ ok: boolean; jobId: string; reused: boolean }>(
      "/api/smart-albums/refresh",
      { method: "POST", body: { force } },
    );
  },
  // 当前任务：没有任务时 task 为 null —— 这是常规状态查询，不是错误。
  smartAlbumRefreshActive(signal?: AbortSignal) {
    return api<{ ok: boolean; task: SmartAlbumRefreshProgress | null }>(
      "/api/smart-albums/refresh/active",
      { signal },
    );
  },
  cancelSmartAlbumRefresh(jobId: string) {
    return api<{ ok: boolean }>(
      `/api/smart-albums/refresh/${encodeURIComponent(jobId)}`,
      { method: "DELETE" },
    );
  },
};

// 阅读/播放活动由 api/activity.ts 独立管理。
// 旧代码请从 'api/prefs' 引入。
