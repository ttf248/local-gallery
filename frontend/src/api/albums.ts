import { api } from "./client";

// 单本文件夹 / 集合 / 智能集合的统一响应。
export interface AlbumDetailResponse<T = unknown> {
  ok: boolean;
  kind: "album" | "collection" | "smart";
  data: T;
}

export interface SearchHit {
  kind: "album" | "collection" | "smartCollection";
  path: string;
  name: string;
  author?: string;
  count: number;
  coverImage?: string;
}

export const albumsApi = {
  detail(id: string) {
    if (id.startsWith("smart:")) {
      return api<AlbumDetailResponse>(
        `/api/tags/${encodeURIComponent(id.slice(6))}`,
      );
    }
    return api<AlbumDetailResponse>(`/api/albums/${encodeURIComponent(id)}`);
  },
  search(q: string, limit = 50) {
    return api<{ ok: boolean; results: SearchHit[]; count: number }>(
      `/api/search`,
      {
        params: { q, limit },
      },
    );
  },
  // 自定义封面：把 file 设为 album path 的封面（持久化到 cover_overrides.json）。
  // 设置后立即拉 /api/library 就能看到新封面。
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
};

// 阅读/播放活动由 api/activity.ts 独立管理。
// 旧代码请从 'api/prefs' 引入。
