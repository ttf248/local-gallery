import { api } from "./client";

// GET /api/cache/stats 的响应体。
export interface CacheStats {
  path: string;
  totalBytes: number;
  fileCount: number;
  scannedAt: string;
  durationMs: number;
  // 目录存在但还没被扫描/读取出错时给 false
  available: boolean;
  // 缓存剩余秒数(后端 30s TTL),前端可据此显示"30s 前更新"
  cacheTtlSeconds: number;
  // 按子目录细分 — 后端独立扫描 thumbs / video-faststart / video-transcode。
  // 子目录不存在时 Available=false,bytes/fileCount 为 0(还没产生过该类缓存)。
  thumbs: SubUsage;
  videoFaststart: SubUsage;
  videoTranscode: SubUsage;
}

// 单个子目录的占用快照。
export interface SubUsage {
  /** 脱敏缓存子目录名称。 */
  path: string;
  bytes: number;
  fileCount: number;
  available: boolean;
}

// POST /api/thumbs/clear 的响应。
export interface CacheClearResult {
  deleted: number;
  freedBytes: number;
}

export const cacheApi = {
  stats: () => api<CacheStats>("/api/cache/stats"),
  // 强制清空全部缩略图缓存(不只过期)。下次访问会按需重新生成。
  clearThumbs: () =>
    api<CacheClearResult>("/api/thumbs/clear", { method: "POST" }),
};

// 把字节数格式化为 B / KB / MB / GB / TB。
//   - 1 KB = 1024 B
//   - 1 MB = 1024 KB
// 保留 1 位小数,小于 1 KB 显示 "X B"。
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  // 1 位小数,但舍去末尾 .0
  const fixed = n.toFixed(1).replace(/\.0$/, "");
  return `${fixed} ${units[i]}`;
}
