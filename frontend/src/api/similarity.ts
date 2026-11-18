import { api } from "./client";

/**
 * 相似照片与连拍整理的接口。
 *
 * 三类结果各自独立标记：完全重复、近似重复、连拍同场景。
 * 「同一场景」不是「重复文件」—— 连拍组里的每一张都是不同的画面，
 * 它们只是拍的是同一个瞬间，因此前端必须按 kind 分开呈现。
 */

/** 分组类别。 */
export type SimilarityGroupKind = "exact" | "near" | "burst";

/** 整理状态。 */
export type SimilarityGroupStatus = "pending" | "reviewed" | "ignored";

/** 一张照片的可解释质量分项。 */
export interface SimilarityQuality {
  /** 拉普拉斯响应的方差，越大越锐。 */
  sharpness: number;
  /** 清晰度分项，0～1。 */
  sharpnessScore: number;
  /** 原图百万像素数。 */
  megapixels: number;
  /** 分辨率分项，0～1。 */
  resolutionScore: number;
  /** 灰度均值，0～1。 */
  exposure: number;
  /** 过曝像素占比。 */
  clippedHigh: number;
  /** 欠曝像素占比。 */
  clippedLow: number;
  /** 曝光分项，0～1。 */
  exposureScore: number;
  /** 代表评分，0～1。 */
  score: number;
}

/** 分组里的一张照片。 */
export interface SimilarityMember {
  resourceId: string;
  folder: string;
  albumId: string;
  albumName: string;
  /** 原图像素尺寸：并排对比时用来算适应比例。 */
  width: number;
  height: number;
  quality: SimilarityQuality;
  capturedAt?: string;
  /** 与代表照片的感知哈希距离，完全重复时为 0。 */
  distance: number;
  /** 与代表照片的相似度，0～1。 */
  similarity: number;
  /** 代表评分，0～1。 */
  score: number;
}

/** 一组相似照片。 */
export interface SimilarityGroup {
  id: string;
  kind: SimilarityGroupKind;
  folder: string;
  resourceIds: string[];
  members: SimilarityMember[];
  /** 算法建议的代表照片。 */
  recommended: string;
  /** 当前生效的代表照片：用户指定过就是用户指定的那张。 */
  representative: string;
  representativeIsManual: boolean;
  distance: number;
  similarity: number;
  timeSpanMs: number;
  /** 时间来源："capture"（拍摄时间）或 "file"（文件时间）。 */
  timeSource: string;
  crossFolder: boolean;
  status: SimilarityGroupStatus;
  /** 除代表之外的照片张数。 */
  redundant: number;
}

/** 一个文件夹里的整理结果概览。 */
export interface SimilarityFolderSummary {
  folder: string;
  groups: number;
  photos: number;
}

/** 整理结果的总量。 */
export interface SimilaritySummary {
  exact: number;
  near: number;
  burst: number;
  pending: number;
  reviewed: number;
  ignored: number;
  photos: number;
  redundant: number;
}

/** 整理模块的整体状态。 */
export interface SimilarityStatus {
  /** 已经算出特征的照片张数。 */
  analyzed: number;
  /** 媒体库里的照片总数。 */
  total: number;
  /** 语义向量索引可用：可用时近似重复的复核更准。 */
  hasVectors: boolean;
  builtAt: string;
  /** 特征变了，分组结果需要重建。 */
  stale: boolean;
  rebuilding: boolean;
  /** 候选召回触到了上限，召回可能不完整。 */
  limited: boolean;
  summary: SimilaritySummary;
}

/** 分组查询结果。 */
export interface SimilarityGroupPage {
  revision: number;
  total: number;
  groups: SimilarityGroup[];
  folders: SimilarityFolderSummary[];
  summary: SimilaritySummary;
  stale: boolean;
  limited: boolean;
}

/** 分组查询条件。 */
export interface SimilarityGroupQuery {
  kind?: SimilarityGroupKind | "";
  status?: SimilarityGroupStatus | "";
  folder?: string;
  limit?: number;
  offset?: number;
}

/** 批量操作的动作。 */
export type SimilarityBatchAction =
  | "review"
  | "unreview"
  | "ignore"
  | "unignore"
  | "pick";

export const similarityApi = {
  status: () => api<{ ok: boolean; status: SimilarityStatus }>("/api/similarity/status"),

  groups: (query: SimilarityGroupQuery = {}) =>
    api<{ ok: boolean; page: SimilarityGroupPage }>("/api/similarity/groups", {
      params: {
        kind: query.kind || undefined,
        status: query.status || undefined,
        folder: query.folder || undefined,
        limit: query.limit,
        offset: query.offset,
      },
    }),

  update: (
    id: string,
    body: { representative?: string; reviewed?: boolean; ignored?: boolean },
  ) =>
    api<{ ok: boolean }>(`/api/similarity/groups/${encodeURIComponent(id)}`, {
      method: "PUT",
      body,
    }),

  /** 重算分组。特征变了但还没重建时用它，不必再跑一遍分析任务。 */
  rebuild: () =>
    api<{ ok: boolean; summary: SimilaritySummary }>("/api/similarity/rebuild", {
      method: "POST",
    }),

  batch: (action: SimilarityBatchAction, groupIds: string[]) =>
    api<{ ok: boolean; changed: number }>("/api/similarity/batch", {
      method: "POST",
      body: { action, groupIds },
    }),
};
