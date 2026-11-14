import { api } from "./client";
import type { AppMode } from "./library";

export interface Prefs {
  favorites: string[];
  history: {
    albumId: string;
    name: string;
    imageCount: number;
    openedAt: string;
  }[];
  maxRecent: number;
  autoSwitchAlbum: boolean;
  showSwitchNotif: boolean;
  theme: "light" | "dark" | "system";
  sidebarCollapsed: boolean;
  /**
   * 全局工作台模式。photo / comic 让列表只呈现对应目录属性的相册，
   * 两档互斥：没有不过滤的「全部」。
   */
  appMode: AppMode;
  /**
   * 侧栏里被收起的导航项 key 列表（见 utils/navEntries.ts）。
   *
   * 存的是生效的清单：不在列表里的入口才显示在侧栏。服务端不知道
   * 这些 key 的含义，只保存与透传。
   */
  hiddenNavItems: string[];
}

export const prefsApi = {
  get: () => api<Prefs>("/api/prefs"),
  patch: (patch: Partial<Prefs>) =>
    api<Prefs>("/api/prefs", { method: "PATCH", body: patch }),
};

export const favoritesApi = {
  batch: (resourceIds: string[], action: "add" | "remove") =>
    api<{ favorites: string[]; updated: number }>("/api/favorites/batch", {
      method: "POST",
      body: { resourceIds, action },
    }),
  list: () => api<{ favorites: string[] }>("/api/favorites"),
  add: (resourceId: string) =>
    api<{ favorites: string[] }>("/api/favorites", {
      method: "POST",
      body: { resourceId },
    }),
  remove: (resourceId: string) =>
    api<{ favorites: string[] }>("/api/favorites", {
      method: "DELETE",
      body: { resourceId },
    }),
  prune: () =>
    api<{ removed: string[] }>("/api/favorites/prune", { method: "POST" }),
};

export const historyApi = {
  list: () => api<{ history: Prefs["history"] }>("/api/history"),
  add: (entry: { albumId: string; name: string; imageCount: number }) =>
    api<{ history: Prefs["history"] }>("/api/history", {
      method: "POST",
      body: entry,
    }),
  remove: (albumId: string) =>
    api<{ ok: boolean; removed: boolean }>(
      `/api/history/${encodeURIComponent(albumId)}`,
      { method: "DELETE" },
    ),
  clear: () => api<{ ok: boolean }>("/api/history", { method: "DELETE" }),
};
