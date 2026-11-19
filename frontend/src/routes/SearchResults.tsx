import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import AlbumGrid from "../components/album/AlbumGrid";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";
import PageHeading from "../components/common/PageHeading";
import { albumsApi, type SearchHit } from "../api/albums";
import type { LibraryNodeSummary } from "../api/library";
import { useLibraryNodes } from "../hooks/useLibrary";
import { useAppMode } from "../hooks/useAppMode";
import { useUIStore } from "../store/uiStore";
import { albumRoute, tagRoute } from "../utils/path";
import { nodeSummaryToCard } from "../utils/libraryCard";
import { LIST_PARAM } from "../utils/listFilterParams";
import type { CardData } from "../components/album/AlbumCard";

const SEARCH_PAGE_SIZE = 100;

/**
 * 名称搜索的结果页。
 *
 * 顶栏的搜索框回车落到这里。以前回车只是把关键词塞进地址再回首页，
 * 而首页那一段是智能相册预览 —— 搜出来的相册被一片不相关的推荐盖住了，
 * 用户看不到自己搜到了什么。现在回车进的是一页可见的结果。
 *
 * 检索范围是全库（相册、集合与标签），不是当前目录：搜「2011」要在
 * 任何一层都找得到。关键词住在地址里，刷新、前进、后退都对。
 */
export default function SearchResults() {
  const { mode } = useAppMode();
  const [params] = useSearchParams();
  const query = (params.get(LIST_PARAM.query) ?? "").trim();
  const viewMode = useUIStore((s) => s.viewMode);

  const search = useInfiniteQuery({
    queryKey: ["library", "search", mode, query, SEARCH_PAGE_SIZE],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      albumsApi.search(query, mode, SEARCH_PAGE_SIZE, pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: query.length >= 1,
    staleTime: 30_000,
    retry: false,
  });

  // 结果列表本身是一个稳定的数组：搜索没返回时给一个空数组，
  // 别每次渲染都造一个新的 —— 下游的 useMemo 依赖它。
  const hits = useMemo(
    () => search.data?.pages.flatMap((page) => page.results) ?? [],
    [search.data],
  );
  const total = search.data?.pages[0]?.count ?? 0;

  // 搜索结果本身没有来源信息（它只给 id、名字与封面）。再查一次节点摘要，
  // 才知道它属于哪个媒体根、上级是哪个集合、封面有哪几张。
  const nodeIds = useMemo(
    () =>
      hits
        .filter((hit) => hit.kind !== "smartCollection")
        .map((hit) => hit.path),
    [hits],
  );
  const nodes = useLibraryNodes(nodeIds);
  const nodeMap = useMemo(() => {
    const map = new Map<string, LibraryNodeSummary>();
    for (const item of nodes.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [nodes.data]);

  const cards = useMemo<CardData[]>(
    () => hits.map((hit) => hitToCard(hit, mode, nodeMap)),
    [hits, mode, nodeMap],
  );

  return (
    <div className="min-h-full">
      <PageHeading
        title={query ? `「${query}」的搜索结果` : "搜索"}
        eyebrow="按名字找"
        description={
          query
            ? `在${mode === "comic" ? "漫画" : "照片"}库里按名字找相册、集合与标签。`
            : "在顶栏的搜索框里输入名字，按回车就能看到结果。"
        }
      />

      <div className="page-shell page-section">
        {search.isError ? (
          <ErrorBanner onRetry={() => void search.refetch()} retrying={search.isFetching}>
            搜索暂时不可用。
          </ErrorBanner>
        ) : null}

        {search.isFetching && cards.length === 0 ? (
          <p className="text-body text-fg-muted">正在搜索…</p>
        ) : null}

        {cards.length > 0 ? (
          <>
            <p className="text-meta text-fg-subtle mb-3 tabular-nums">
              {cards.length < total
                ? `显示 ${cards.length} / ${total} 项`
                : `共 ${total} 项`}
            </p>
            <AlbumGrid items={cards} variant={viewMode} />
            {search.hasNextPage ? (
              <button
                type="button"
                className="button-secondary mt-6"
                onClick={() => void search.fetchNextPage()}
                disabled={search.isFetchingNextPage}
              >
                {search.isFetchingNextPage
                  ? "正在加载…"
                  : `加载更多（还剩 ${total - cards.length} 项）`}
              </button>
            ) : null}
          </>
        ) : null}

        {!search.isFetching && !search.isError && cards.length === 0 && query ? (
          <EmptyState
            title={`没有匹配「${query}」的相册、集合或标签`}
            description="名字里没有这几个字。换个说法，或者按画面内容找 —— 内容搜索能认出照片里的东西。"
          />
        ) : null}

        {!query ? (
          <EmptyState
            title="还没有搜索"
            description="在顶栏的搜索框里输入相册、集合或标签的名字。"
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * 搜索命中 → 卡片。
 *
 * 命中只带 id、名字与一张封面；节点摘要补上来源、层级与多张封面 ——
 * 「这个相册属于哪个目录」是结果页必须回答的问题。
 */
function hitToCard(
  hit: SearchHit,
  mode: "photo" | "comic",
  nodeMap: Map<string, LibraryNodeSummary>,
): CardData {
  if (hit.kind === "smartCollection") {
    const tag = hit.path.startsWith("smart:") ? hit.path.slice(6) : hit.name;
    return {
      id: "s:" + tag,
      variant: "smart",
      title: hit.name || tag,
      count: hit.count,
      coverPath: hit.coverImage ?? "",
      coverVersion: hit.coverImageVersion,
      to: tagRoute(mode, tag),
      contentKind: mode,
    };
  }

  const node = nodeMap.get(hit.path);
  if (node) {
    const card = nodeSummaryToCard(node);
    // 副标题补上来源：多根扫描时「2011年」这种同名文件夹有好几个，
    // 结果页必须说清它属于哪一个媒体目录。
    const type = node.kind === "collection" ? "集合" : hit.virtual ? "散图" : "";
    const source = node.sourceName ?? "";
    const parts = [type, source].filter(Boolean);
    return { ...card, subtitle: parts.length > 0 ? parts.join(" · ") : card.subtitle };
  }

  // 摘要还没到（或这一项已经失效）：先用命中的信息摆出来，
  // 别因为一次补充查询失败就什么都不显示。
  const isAlbum = hit.kind === "album";
  return {
    id: (isAlbum ? "a:" : "c:") + hit.path,
    variant: hit.kind,
    title: hit.name,
    subtitle: hit.virtual ? "散图" : isAlbum ? hit.tags?.join(" · ") : "集合",
    count: hit.count,
    coverPath: hit.coverImage ?? "",
    coverVersion: hit.coverImageVersion,
    to: albumRoute(mode, hit.path),
    contentKind: hit.contentKind ?? mode,
  };
}
