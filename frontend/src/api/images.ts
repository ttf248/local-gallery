import { API_BASE } from "./client";

// 全图 URL（与 thumbUrl 对应）
export function imageUrl(fileId: string): string {
  const p = `/api/media/${encodeURIComponent(fileId)}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}
