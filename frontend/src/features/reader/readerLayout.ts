export function clampPage(index: number, total: number): number {
  return Math.max(
    0,
    Math.min(total - 1, Number.isFinite(index) ? Math.floor(index) : 0),
  );
}

export function spreadAt(target: number, total: number): number[] {
  if (total <= 0) return [];
  const first = 2 * Math.floor(clampPage(target, total) / 2);
  return first + 1 < total ? [first, first + 1] : [first];
}
