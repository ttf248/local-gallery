import type { CSSProperties } from "react";
import type { FaceBox } from "../api/aiJobs";

/**
 * 人物预览里「把脸放到方块中央」的位置。
 *
 * 人物分组的封面照片往往是一张合影：脸只占画面里很小一块，整张当封面
 * 时用户看到的是「有人的照片」，认不出是哪个人。这里按人脸框算出一张
 * 放大并平移过的图，让脸占满方块。
 *
 * 算的是图片在方块里的位置（百分比），不是缩放矩阵：图片的宽高都按
 * 同一个 `span` 换算，比例因此原样保留，不会把脸拉变形。
 *
 * span 是方块在原图里覆盖的那一段：默认让脸占方块的八成，再按需要
 * 收窄 —— 方块必须被图片盖满（span 不超过原图短边），否则方块边缘
 * 会露出空隙。
 */
export function personFaceCropStyle(
  box: FaceBox,
  imageWidth: number,
  imageHeight: number,
): CSSProperties | null {
  if (
    box.length !== 4 ||
    ![imageWidth, imageHeight, ...box].every(Number.isFinite) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return null;
  }

  const [x, y, width, height] = box;
  if (width <= 0 || height <= 0) return null;

  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const faceSpan = Math.max(width, height) / 0.8;
  const span = Math.min(faceSpan, Math.min(imageWidth, imageHeight));
  if (span <= 0) return null;

  return {
    position: "absolute",
    left: `${((span / 2 - centerX) / span) * 100}%`,
    top: `${((span / 2 - centerY) / span) * 100}%`,
    width: `${(imageWidth / span) * 100}%`,
    height: `${(imageHeight / span) * 100}%`,
    // Tailwind 的基础样式给图片加了 max-width: 100%，那会把放大后的
    // 图片压回方块大小，脸就又缩回角落里去了。
    maxWidth: "none",
  };
}
