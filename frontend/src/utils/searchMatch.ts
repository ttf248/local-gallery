/**
 * 名称命中的一句话说明。
 *
 * 搜索结果页要标出「相关性」——但相关性不是一个分数，是一个理由：
 * 完全同名、开头相同、名字里含有、标签命中。用户看到理由才知道
 * 该往哪一步找，而不是盯着一个不明所以的排名。
 */
export const SEARCH_MATCH_LABELS: Record<string, string> = {
  exact: "名字完全相同",
  prefix: "名字以关键词开头",
  contains: "名字里含有关键词",
  tag: "标签命中",
  path: "归属路径里含有关键词",
};

/** 命中理由；没有理由时返回 undefined（不摆空标签）。 */
export function searchMatchLabel(match?: string): string | undefined {
  if (!match) return undefined;
  return SEARCH_MATCH_LABELS[match];
}

/** 结果页顶上那句话：命中是怎么排的。 */
export const SEARCH_MATCH_ORDER_HINT =
  "按相关度排列：名字完全相同 → 开头相同 → 名字里含有 → 标签命中。";
