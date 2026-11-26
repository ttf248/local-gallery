export type SimilarityViewMode = "review" | "grid";

export function resolveSimilarityView(
  param: string | null,
  isWide: boolean,
): SimilarityViewMode {
  return param === "review" || param === "grid"
    ? param
    : isWide
      ? "review"
      : "grid";
}

export function nextActiveAfterRemoval(
  ids: readonly string[],
  removedId: string,
): string | null {
  const index = ids.indexOf(removedId);
  if (index < 0) return ids[0] ?? null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

export function clampMemberIndex(index: number, length: number) {
  return Math.min(Math.max(0, Math.trunc(index) || 0), Math.max(0, length - 1));
}

export function shouldPrefetch(
  index: number,
  loaded: number,
  hasMore: boolean,
  threshold = 5,
) {
  return (
    index >= 0 && index < loaded && hasMore && loaded - index - 1 <= threshold
  );
}
