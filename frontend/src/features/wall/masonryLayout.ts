/**
 * 瀑布流排布算法。
 *
 * 与照片墙的 justified layout 不同：那里一行一行地凑齐，瀑布流是每张
 * 照片落进当前最矮的那一列，因此各列高度参差 —— 竖幅照片不必被裁，
 * 也不用为了填满一行而缩放。
 *
 * 这里是纯函数，不碰 DOM：布局要在容器宽度、照片数量或尺寸变化时反复
 * 重算，纯函数才好测、好缓存。
 */

/** 未知宽高比时使用的默认比例（3:2）。 */
export const DEFAULT_MASONRY_RATIO = 1.5;

/** 排布输入的一项。ratio 是宽 / 高。 */
export interface MasonryInput {
  id: string;
  ratio: number;
  /**
   * 图片之外还要占的高度（像素）。
   *
   * 照片墙里的每一块就是一张图，高度由比例算出；卡片不一样 ——
   * 封面下面还有标题与说明，那部分是固定的，按比例算不出来。
   */
  extraHeight?: number;
}

/** 排布输出的一项：位置与尺寸都是容器内的像素坐标。 */
export interface MasonryTile {
  id: string;
  /** 在输入序列里的下标。 */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MasonryLayout {
  tiles: MasonryTile[];
  /** 整体高度（容器内坐标）。 */
  height: number;
  columns: number;
  columnWidth: number;
}

export interface MasonryOptions {
  /** 可用宽度（像素）。 */
  containerWidth: number;
  /** 目标列宽（像素）：列宽按它算，实际列宽由容器宽度摊平。 */
  targetColumnWidth: number;
  /** 列与列之间的间距（像素）。 */
  gap: number;
  /**
   * 明确的列数。
   *
   * 不给就按容器宽度算。给了就照给的来 —— 条数少的场合（首页预览
   * 只有六张）需要列数能整除条数，否则末行只挂一张卡。
   */
  columns?: number;
}

/** 按容器宽度算列数：宽屏上列多、窄屏上列少。 */
export function masonryColumnCount(
  containerWidth: number,
  targetColumnWidth: number,
  gap: number,
): number {
  if (containerWidth <= 0) return 1;
  return Math.max(
    1,
    Math.floor((containerWidth + gap) / (targetColumnWidth + gap)),
  );
}

/**
 * 把一组带比例的条目排成瀑布流。
 *
 * 规则：每张照片放进当前最矮的那一列，因此列高自然参差；列宽按容器
 * 宽度摊平 —— 目标列宽只决定列数，剩下的宽度均分给各列，不留半列。
 */
export function layoutMasonry(
  items: readonly MasonryInput[],
  options: MasonryOptions,
): MasonryLayout {
  const { containerWidth, targetColumnWidth, gap } = options;
  if (containerWidth <= 0 || items.length === 0) {
    return { tiles: [], height: 0, columns: 0, columnWidth: 0 };
  }
  const columns =
    options.columns && options.columns > 0
      ? Math.min(options.columns, items.length)
      : masonryColumnCount(containerWidth, targetColumnWidth, gap);
  const columnWidth = (containerWidth - gap * (columns - 1)) / columns;
  const heights = new Array<number>(columns).fill(0);
  const tiles: MasonryTile[] = [];
  items.forEach((item, index) => {
    let column = 0;
    for (let candidate = 1; candidate < columns; candidate += 1) {
      if (heights[candidate] < heights[column]) column = candidate;
    }
    const ratio = item.ratio > 0 ? item.ratio : DEFAULT_MASONRY_RATIO;
    const height = columnWidth / ratio + (item.extraHeight ?? 0);
    tiles.push({
      id: item.id,
      index,
      x: column * (columnWidth + gap),
      y: heights[column],
      width: columnWidth,
      height,
    });
    heights[column] += height + gap;
  });
  let tallest = 0;
  for (const height of heights) {
    if (height > tallest) tallest = height;
  }
  return {
    tiles,
    height: Math.max(0, tallest - gap),
    columns,
    columnWidth,
  };
}
