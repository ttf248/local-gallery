/**
 * 「接着看」面板里队列排几件的算法。
 *
 * 单独成文件：组件文件只导出组件，导出函数会让热更新失效
 * （eslint 的 react-refresh 规则）。
 */

/** 队列里一件展品的最小边长：与主角那枚裱框同尺寸。 */
export const SHELF_ITEM_MIN = 176;
/** 窄屏上队列一件小一号：这么窄的一段横排放不下 176px 的方照。 */
export const SHELF_ITEM_MIN_NARROW = 100;
/** 队列最多摆几件。再多就成了一面墙，不是「接着看」。 */
export const SHELF_MAX_ITEMS = 12;
/** 量不到宽度时先摆这么多，等测量到了再改。 */
export const SHELF_FALLBACK_ITEMS = 5;

/**
 * 队列这一排摆几件。
 *
 * 面板横排时主角在左、队列在右，队列有多宽就摆多少件：宽屏上多摆
 * 几件，而不是把同样的几件拉大。拉大之后排里的方照比主角那枚裱框
 * 还大，主次就反了；列数写死则宽屏上要么空出一段地，要么把队列撑
 * 成一面巨幅海报。
 *
 * @param width 队列那一段的实际宽度（像素）；量不到时传 0。
 * @param available 还能摆几件（相册不够时按实际数）。
 */
export function shelfItemCount(width: number, available: number): number {
  if (available <= 0) return 0;
  // 量不到宽度（首帧、或没有布局的环境）：先按旧例摆五件。
  if (width <= 0) return Math.min(SHELF_FALLBACK_ITEMS, available);
  const narrow = width < 640;
  const itemMin = narrow ? SHELF_ITEM_MIN_NARROW : SHELF_ITEM_MIN;
  // 与 CSS 里的 clamp(12px, 1.4vw, 20px) 对齐。
  const gap = narrow ? 12 : 20;
  // 四舍五入而不是向下取整：格子是等宽的（1fr），少摆一件时剩下的
  // 地全给了那一件，方照会比主角那枚裱框还大。
  const fit = Math.round((width + gap) / (itemMin + gap));
  return Math.max(1, Math.min(fit, available, SHELF_MAX_ITEMS));
}
