import type {
  ReaderMode,
  FitMode,
  ReadDirection,
} from "../../store/galleryStore";
export function clampPage(index: number, total: number): number {
  return Math.max(
    0,
    Math.min(total - 1, Number.isFinite(index) ? Math.floor(index) : 0),
  );
}

export function spreadAt(
  target: number,
  total: number,
  coverOffset = false,
  wideFlags?: readonly boolean[],
): number[] {
  if (total <= 0) return [];
  const page = clampPage(target, total);
  if (wideFlags) {
    for (let i = 0; i < total;) {
      const single =
        (coverOffset && i === 0) ||
        wideFlags[i] ||
        wideFlags[i + 1] ||
        i + 1 === total;
      const end = single ? i : i + 1;
      if (page <= end) return single ? [i] : [i, end];
      i = end + 1;
    }
  }
  if (coverOffset && page === 0) return [0];
  const offset = coverOffset ? 1 : 0;
  const first = offset + 2 * Math.floor((page - offset) / 2);
  return first + 1 < total ? [first, first + 1] : [first];
}

export function nextSpreadIndex(
  current: number,
  total: number,
  coverOffset = false,
  wideFlags?: readonly boolean[],
) {
  const pages = spreadAt(current, total, coverOffset, wideFlags);
  return clampPage((pages.at(-1) ?? -1) + 1, total);
}
export function prevSpreadIndex(
  current: number,
  total: number,
  coverOffset = false,
  wideFlags?: readonly boolean[],
) {
  const start = spreadAt(current, total, coverOffset, wideFlags)[0] ?? 0;
  return (
    spreadAt(clampPage(start - 1, total), total, coverOffset, wideFlags)[0] ?? 0
  );
}

export type Rotation = 0 | 90 | 180 | 270;
export type Size = Readonly<{ width: number; height: number }>;
export interface PageInput {
  index: number;
  fileId: string;
  source: Size;
}
export interface LayoutInput {
  viewport: Size;
  pages: readonly PageInput[];
  mode: ReaderMode;
  fit: FitMode;
  direction: ReadDirection;
  rotation: Rotation;
  zoom: number;
  gap: number;
}
export interface PageBox {
  index: number;
  fileId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}
export interface PageLayout {
  extent: Size;
  boxes: readonly PageBox[];
}
export function validSize(size: Size | undefined): size is Size {
  return (
    !!size &&
    Number.isFinite(size.width) &&
    size.width > 0 &&
    Number.isFinite(size.height) &&
    size.height > 0
  );
}
export function layoutPages(input: LayoutInput): PageLayout {
  const { viewport, pages, mode, fit, direction, rotation } = input;
  if (
    !validSize(viewport) ||
    !pages.length ||
    pages.some((p) => !validSize(p.source))
  )
    return { extent: { width: 0, height: 0 }, boxes: [] };
  const sideways = rotation === 90 || rotation === 270;
  const order =
    direction === "rtl" && mode === "double" ? [...pages].reverse() : pages;
  const widths = order.map(({ source }) =>
    sideways ? source.height : source.width,
  );
  const heights = order.map(({ source }) =>
    sideways ? source.width : source.height,
  );
  const gap =
    order.length > 1
      ? Math.min(
          viewport.width,
          Math.max(0, Number.isFinite(input.gap) ? input.gap : 0),
        )
      : 0;
  const available = Math.max(0, viewport.width - gap * (order.length - 1));
  const widthScale = available / widths.reduce((a, b) => a + b, 0);
  const heightScale = viewport.height / Math.max(...heights);
  const base = {
    fit: Math.min(widthScale, heightScale, 1),
    width: widthScale,
    height: heightScale,
    original: 1,
  }[fit];
  const scale =
    base *
    (Number.isFinite(input.zoom) ? Math.max(0.1, Math.min(5, input.zoom)) : 1);
  const contentWidth =
    widths.reduce((a, b) => a + b * scale, 0) + gap * (order.length - 1);
  const contentHeight = Math.max(...heights) * scale;
  const extent = {
    width: Math.max(viewport.width, contentWidth),
    height:
      mode === "continuous"
        ? contentHeight
        : Math.max(viewport.height, contentHeight),
  };
  const space = extent.width - contentWidth;
  let x =
    mode === "double" && order.length === 1
      ? direction === "rtl"
        ? space
        : 0
      : space / 2;
  const y = (extent.height - contentHeight) / 2;
  const boxes = order.map(({ index, fileId, source }, i) => {
    const width = widths[i] * scale,
      height = heights[i] * scale;
    const box = {
      index,
      fileId,
      x,
      y,
      width,
      height,
      imageWidth: source.width * scale,
      imageHeight: source.height * scale,
    };
    x += width + gap;
    return box;
  });
  return { extent, boxes };
}
