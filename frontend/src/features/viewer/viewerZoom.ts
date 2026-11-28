type Point = { x: number; y: number };

// 光标相对舞台中心的位置在缩放前后对应同一个图像像素。
export function zoomAroundPoint(
  pan: Point,
  point: Point,
  from: number,
  to: number,
): Point {
  const ratio = to / from;
  return {
    x: point.x - (point.x - pan.x) * ratio,
    y: point.y - (point.y - pan.y) * ratio,
  };
}
