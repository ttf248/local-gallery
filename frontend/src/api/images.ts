import { apiUrl } from "./client";

// 全图 URL（与 thumbUrl 对应）
export function imageUrl(fileId: string): string {
  return apiUrl(`/api/media/${encodeURIComponent(fileId)}`);
}

// 预览图 URL：服务端按宽度等比缩放后的 JPEG。
//
// 阅读器连续模式按视口宽度展示图片，直接用原图的话手机照片动辄 5MB+，
// 一屏就是几 MB，整本翻完是 GB 级流量。预览图约为原图的 1/10~1/30。
//
// 宽度会向上对齐到服务端固定的档位阶梯（320/640/1280/1920/2560/4096），
// 同一张源图不会因为视口差几十像素就多出一份缓存产物。
//
// version 是媒体内容版本号：带上之后且与当前源文件一致，服务端回
// immutable，浏览器可以长期缓存。
export function previewUrl(
  fileId: string,
  width: number,
  version?: string,
): string {
  const w = Math.max(320, Math.min(4096, Math.round(width)));
  // 查询串统一由 client.ts 的 buildQuery 拼：自己手写 "?w=…" 再拼一个
  // "?v=…" 会拼出两个问号，服务端把 "?v=…" 当成 w 的值，整张图直接 400。
  return apiUrl(`/api/previews/${encodeURIComponent(fileId)}`, {
    w,
    v: version,
  });
}
