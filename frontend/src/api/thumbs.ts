import { api, apiUrl } from "./client";

/**
 * 渲染图 URL 构造。
 *
 * 参数：
 *   - fileId：服务端生成的文件资源 ID。
 *   - version：媒体内容版本号（源文件 mtime + size + 渲染算法版本）。
 *     带上的请求若与当前版本一致，服务端回 immutable，浏览器可以长期
 *     缓存 —— 重复打开页面时这张图一次网络请求都不发。
 *   - width：渲染档位宽度；缺省用服务端缺省档位。
 */
export function thumbUrl(
  fileId: string,
  version?: string,
  width?: number,
): string {
  return apiUrl(`/api/thumbs/${encodeURIComponent(fileId)}`, {
    w:
      typeof width === "number" && Number.isFinite(width) && width > 0
        ? Math.round(width)
        : undefined,
    v: version,
  });
}

/**
 * thumbSrcSet 构造 srcset 候选列表。
 *
 * 渲染不裁剪，同一张源图在各档之间宽高比一致，所以浏览器可以按
 * "需要多宽"自由挑档，页面也不会因为换档而跳版。
 */
export function thumbSrcSet(
  fileId: string,
  version: string | undefined,
  widths: number[],
): string {
  return widths
    .map((width) => `${thumbUrl(fileId, version, width)} ${width}w`)
    .join(", ");
}

// 把视频封面上传到后端。后端会把字节 resize → 缓存到磁盘。
//
// 走统一的请求出口：会话 cookie 带上、失败抛 ApiError（带后端的
// code 与 message），调用方不必自己解析错误结构。
export async function uploadVideoCover(
  fileId: string,
  blob: Blob,
  signal?: AbortSignal,
): Promise<void> {
  await api<{ ok: boolean }>(
    `/api/thumbs/${encodeURIComponent(fileId)}/cover`,
    { method: "POST", body: blob, signal },
  );
}

export interface ThumbnailStats {
  memoryItems: number;
  diskFiles: number;
  cacheDir: string;
}
