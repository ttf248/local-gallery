export type Side = "top" | "bottom" | "left" | "right";
export function floatingPosition(
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  width: number,
  height: number,
  side: Side,
  align: "start" | "center" | "end" = "center",
  gap = 8,
) {
  const room = {
    left: anchor.left,
    right: innerWidth - anchor.right,
    top: anchor.top,
    bottom: innerHeight - anchor.bottom,
  };
  const opposite = {
    left: "right",
    right: "left",
    top: "bottom",
    bottom: "top",
  } as const;
  const vertical = side === "top" || side === "bottom";
  if (
    room[side] < (vertical ? height : width) + gap &&
    room[opposite[side]] > room[side]
  )
    side = opposite[side];
  function offset(start: number, end: number, length: number) {
    return align === "start"
      ? start
      : align === "end"
        ? end - length
        : (start + end - length) / 2;
  }
  const left = vertical
    ? offset(anchor.left, anchor.right, width)
    : side === "left"
      ? anchor.left - width - gap
      : anchor.right + gap;
  const top = !vertical
    ? offset(anchor.top, anchor.bottom, height)
    : side === "top"
      ? anchor.top - height - gap
      : anchor.bottom + gap;
  return {
    left: Math.max(4, Math.min(left, innerWidth - width - 4)),
    top: Math.max(4, Math.min(top, innerHeight - height - 4)),
  };
}
