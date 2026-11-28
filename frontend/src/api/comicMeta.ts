export type ComicEpisodeType =
  "main" | "extra" | "special" | "volume" | "unknown";
export type ComicMetaSource =
  "manual" | "local_file" | "online" | "local_ocr" | "rule";
export type ComicSeriesStatus = "ongoing" | "completed" | "hiatus" | "unknown";

export interface ComicNodeMeta {
  firstEpisodeId?: string;
  firstEpisodeLabel?: string;
  cleanTitle: string;
  originalName?: string;
  chapterLabel?: string;
  chapterNumber?: number;
  episodeType?: ComicEpisodeType;
  author?: string;
  synopsis?: string;
  hasFullSynopsis?: boolean;
  genres?: string[];
  status?: ComicSeriesStatus;
  mainCount?: number;
  extraCount?: number;
  metaSource: ComicMetaSource;
  locked?: boolean;
  coverReason?: string;
}

export interface ComicMetaDetail extends ComicNodeMeta {
  nodeId: string;
  kind: "collection" | "album";
  fullSynopsis?: string;
  aliases: string[];
  provider?: string;
  confidence?: number;
  updatedAt?: string;
  hasCustomCover: boolean;
  coverCandidates: import("./library").CoverCandidate[];
}

export interface ComicMetaEditPayload {
  title?: string | null;
  author?: string | null;
  synopsis?: string | null;
  genres?: string[] | null;
  status?: ComicSeriesStatus | null;
  locked?: boolean;
}

import { api } from "./client";
import type { CoverCandidate } from "./library";

export interface ComicCoverCandidatesResponse {
  coverCandidates: CoverCandidate[];
}
interface ComicMetaResponse {
  meta: ComicMetaDetail;
  revision: number;
  warning?: string;
}
const endpoint = (id: string) => `/api/comics/${encodeURIComponent(id)}/meta`;
export const comicMetaApi = {
  get: (id: string, signal?: AbortSignal) =>
    api<ComicMetaResponse>(endpoint(id), { signal }),
  update: (id: string, body: ComicMetaEditPayload) =>
    api<ComicMetaResponse>(endpoint(id), { method: "PUT", body }),
  reset: (id: string) =>
    api<ComicMetaResponse>(endpoint(id), { method: "DELETE" }),
  refresh: (id: string, allowOnline?: boolean) =>
    api<ComicMetaResponse>(endpoint(id) + "/refresh", {
      method: "POST",
      body: { force: true, allowOnline },
    }),
  cover: (id: string, file?: string) =>
    api<{ revision: number }>(
      `/api/collections/${encodeURIComponent(id)}/cover`,
      { method: file ? "PUT" : "DELETE", params: { file } },
    ),
};
export const comicSourceLabels: Record<ComicMetaSource, string> = {
  manual: "人工编辑",
  local_file: "本地元数据",
  online: "Bangumi",
  local_ocr: "本机文字识别",
  rule: "目录规则",
};
