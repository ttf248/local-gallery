/**
 * 「那年今日」缩略图的尺寸。
 *
 * 这一条是回忆的入口：用户要认出「往年这天我拍到了什么」，所以缩略图
 * 得看得清，也要留着画面的完整比例 —— 裁成方块会把构图切掉，而切掉的
 * 那一角往往正是内容本身。
 */

/** 缩略图的高度（CSS 像素）。 */
export const ON_THIS_DAY_THUMB_HEIGHT = 96;

/**
 * 缩略图的宽度范围（CSS 像素）。
 *
 * 宽度按照片自身的比例算，但两头要收住：竖幅照片不能窄成一条缝，
 * 极端宽幅（全景）也不能把一行撑散。
 */
export const ON_THIS_DAY_MIN_THUMB_WIDTH = 64;
export const ON_THIS_DAY_MAX_THUMB_WIDTH = 176;

/**
 * 缩略图的宽度（CSS 像素）：按照片自身的比例算，两头收住。
 *
 * 比例未知（扫描时没读到像素）时按 3:2 兜底 —— 照片大多是横幅，
 * 这个猜测比一律按方块更接近真相。
 */
export function onThisDayThumbWidth(width?: number, height?: number): number {
  const aspect = width && height ? width / height : 3 / 2;
  return Math.round(
    Math.min(
      ON_THIS_DAY_MAX_THUMB_WIDTH,
      Math.max(ON_THIS_DAY_MIN_THUMB_WIDTH, ON_THIS_DAY_THUMB_HEIGHT * aspect),
    ),
  );
}
