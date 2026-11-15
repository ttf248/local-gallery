import { vi } from "vitest";
import type {
  LibraryNodeSummary,
  LibraryListQuery,
  LibraryListPage,
} from "./api/library";
import { listItemToCard } from "./hooks/useLibraryList";

// 路由测试使用服务端已分页结果；筛选排序规则由后端测试覆盖。
//
// 年份分组在生产里由服务端算好（/api/library/overview 的 years 字段），
// 这里按节点名里的 4 位年份造出等价的分桶，让首页时间线在测试里有内容。
function yearBuckets(nodes: LibraryNodeSummary[]) {
  const buckets = new Map<number | null, LibraryNodeSummary[]>();
  for (const node of nodes) {
    const match = node.name.match(/(\d{4})/);
    const parsed = match ? Number.parseInt(match[1], 10) : NaN;
    const year =
      Number.isFinite(parsed) && parsed >= 1900 && parsed <= 2100 ? parsed : null;
    const list = buckets.get(year);
    if (list) list.push(node);
    else buckets.set(year, [node]);
  }
  return [...buckets.entries()]
    .sort((a, b) => {
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      return b[0] - a[0];
    })
    .map(([year, group]) => ({
      year,
      count: group.length,
      imageTotal: group.reduce((sum, n) => sum + (n.imageCount ?? 0), 0),
      videoTotal: group.reduce((sum, n) => sum + (n.videoCount ?? 0), 0),
      group,
    }));
}

export function listFixture(
  fixture: {
    data?: { items: LibraryNodeSummary[]; total?: number; revision?: number };
    isLoading?: boolean;
  },
  query: LibraryListQuery = { kind: "photo", parent: "fixture" },
) {
  const nodes = fixture.data?.items ?? [];
  const items = nodes.map((node) => ({ kind: node.kind, node }));
  const counts = {
    all: nodes.length,
    album: nodes.filter((n) => n.kind === "album").length,
    collection: nodes.filter((n) => n.kind === "collection").length,
    smart: 0,
  };
  const summary: LibraryListPage | undefined = fixture.data
    ? {
        revision: fixture.data.revision ?? 1,
        items,
        total: fixture.data.total ?? nodes.length,
        counts,
        years: yearBuckets(nodes).map((bucket) => ({
          year: bucket.year,
          count: bucket.count,
          imageTotal: bucket.imageTotal,
          videoTotal: bucket.videoTotal,
          target:
            items.find((i) => i.node.id === bucket.group[0]?.id.slice(2)) ??
            items[0],
        })),
        series: [],
        imageTotal: nodes.reduce((sum, n) => sum + (n.imageCount ?? 0), 0),
        videoTotal: nodes.reduce((sum, n) => sum + (n.videoCount ?? 0), 0),
      }
    : undefined;
  return {
    ...fixture,
    summary,
    cards: items.map((item) => listItemToCard(item, query)),
    query,
    data: summary ? { pages: [summary], pageParams: [undefined] } : undefined,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetching: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    nextCursor: undefined,
  };
}
