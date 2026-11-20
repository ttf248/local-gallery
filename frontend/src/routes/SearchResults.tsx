import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import AlbumGrid from "../components/album/AlbumGrid";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";
import PageHeading from "../components/common/PageHeading";
import Segmented from "../components/common/Segmented";
import { albumsApi, type SearchHit } from "../api/albums";
import { aiJobsApi } from "../api/aiJobs";
import type { LibraryNodeSummary } from "../api/library";
import { useLibraryNodes } from "../hooks/useLibrary";
import { useAppMode } from "../hooks/useAppMode";
import { useUIStore } from "../store/uiStore";
import {
  albumRoute,
  exploreRoute,
  libraryRoute,
  tagRoute,
} from "../utils/path";
import { nodeSummaryToCard } from "../utils/libraryCard";
import { collectionTypeWord } from "../utils/workbench";
import { LIST_PARAM } from "../utils/listFilterParams";
import { useSafeBack } from "../utils/navigation";
import {
  SEARCH_SCOPE_PARAM,
  searchScopeFromParams,
  type SearchScope,
} from "../utils/searchScope";
import { SEARCH_MATCH_ORDER_HINT, searchMatchLabel } from "../utils/searchMatch";
import type { CardData } from "../components/album/AlbumCard";
import ContentSearchResults from "../components/search/ContentSearchResults";
import type { ContentSearchSubmission } from "../hooks/useContentSearchQuery";

const SEARCH_PAGE_SIZE = 100;

/**
 * 搜索结果页。
 *
 * 顶栏的搜索框回车落到这里。以前回车只是把关键词塞进地址再回首页，
 * 而首页那一段是智能相册预览 —— 搜出来的相册被一片不相关的推荐盖住了，
 * 用户看不到自己搜到了什么。现在回车进的是一页可见的结果。
 *
 * 一页管两类检索对象：容器的**名字**与照片里的**画面 / 文字**。
 * 两者检索的东西不同，界面上用一个分段控件说清当前是哪一类，
 * 关键词与作用域都住在地址里：刷新、前进、后退都对。
 */
export default function SearchResults() {
  const { mode } = useAppMode();
  const [params, setParams] = useSearchParams();
  const query = (params.get(LIST_PARAM.query) ?? "").trim();
  const scope: SearchScope =
    mode === "comic" ? "name" : searchScopeFromParams(params);
  const viewMode = useUIStore((s) => s.viewMode);
  // 返回：应用内还有历史就回退；深链直接打开时回到能确认的来路 ——
  // 照片侧回发现页（那儿是找东西的地方），漫画侧回书架。
  const goBack = useSafeBack(() =>
    mode === "photo" ? exploreRoute() : libraryRoute(mode),
  );

  const search = useInfiniteQuery({
    queryKey: ["library", "search", mode, query, SEARCH_PAGE_SIZE],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      albumsApi.search(query, mode, SEARCH_PAGE_SIZE, pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: query.length >= 1 && scope === "name",
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
  // 命中理由按卡片 id 存：卡片 id 加过前缀（a: / c: / s:），
  // 拿命中反查卡片会错位。
  const matchLabels = useMemo(() => {
    const map = new Map<string, string | undefined>();
    cards.forEach((card, index) => {
      map.set(card.id, searchMatchLabel(hits[index]?.match));
    });
    return map;
  }, [cards, hits]);

  const isContent = scope === "content";
  const setScope = (next: SearchScope) => {
    const nextParams = new URLSearchParams(params);
    if (next === "content") nextParams.set(SEARCH_SCOPE_PARAM, "content");
    else nextParams.delete(SEARCH_SCOPE_PARAM);
    setParams(nextParams, { replace: true });
  };
  const clearConditions = () => {
    setParams(new URLSearchParams(), { replace: true });
  };

  return (
    <div className="min-h-full">
      <PageHeading
        title={query ? `「${query}」的搜索结果` : "搜索"}
        eyebrow={isContent ? "按画面与文字找" : "按名字找"}
        description={
          query
            ? isContent
              ? "在照片的画面与图片文字里找。命中按相似度排列。"
              : `在${mode === "comic" ? "漫画" : "照片"}库里按名字找相册、文件夹与标签。`
            : "在顶栏的搜索框里输入关键词，按回车就能看到结果。"
        }
      />

      <div className="page-shell">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-faint pb-3">
          {mode === "photo" ? (
            <Segmented
              label="搜索范围"
              value={scope}
              onChange={setScope}
              options={[
                { value: "name", label: "名称" },
                { value: "content", label: "画面与文字" },
              ]}
            />
          ) : (
            <span className="chip">名称</span>
          )}
          <span className="text-meta text-fg-muted">
            {isContent
              ? "正在搜照片里的画面与图片文字"
              : "正在搜相册、文件夹与标签的名字"}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={goBack}
            >
              返回
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={clearConditions}
              disabled={!query}
            >
              清除条件
            </button>
          </div>
        </div>
      </div>

      {isContent ? (
        <ContentScopeResults query={query} />
      ) : (
        <div className="page-shell page-section">
          {search.isError ? (
            <ErrorBanner
              onRetry={() => void search.refetch()}
              retrying={search.isFetching}
            >
              搜索暂时不可用。
            </ErrorBanner>
          ) : null}

          {search.isFetching && cards.length === 0 ? (
            <p className="text-body text-fg-muted">正在搜索…</p>
          ) : null}

          {cards.length > 0 ? (
            <>
              <p className="text-meta text-fg-subtle mb-1 tabular-nums">
                {cards.length < total
                  ? `显示 ${cards.length} / ${total} 项`
                  : `共 ${total} 项`}
                {" · "}
                {SEARCH_MATCH_ORDER_HINT}
              </p>
              <AlbumGrid
                items={cards}
                variant={viewMode}
                note={(item) => matchLabels.get(item.id)}
              />
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
              title={`没有匹配「${query}」的相册、文件夹或标签`}
              description="名字里没有这几个字。换个说法，或者按画面内容找 —— 内容搜索能认出照片里的东西。"
              action={
                mode === "photo" ? (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setScope("content")}
                  >
                    按画面与文字再找一次
                  </button>
                ) : undefined
              }
            />
          ) : null}

          {!query ? (
            <EmptyState
              title="还没有搜索"
              description="在顶栏的搜索框里输入相册、文件夹或标签的名字。"
              action={
                <Link className="btn btn-outline" to={exploreRoute()}>
                  去发现页找东西
                </Link>
              }
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * 内容搜索那一档。
 *
 * 与「智能搜索」页共用同一套检索与呈现；差别只在这一页是从地址里的
 * 关键词来的，没有那些高级筛选。
 */
function ContentScopeResults({ query }: { query: string }) {
  const statusQuery = useQuery({
    queryKey: ["ai-embedding-status"],
    queryFn: aiJobsApi.embeddingStatus,
    staleTime: 30_000,
    retry: false,
  });
  const status = statusQuery.data?.status;
  const embeddingReady = Boolean(status?.runtimeReady && status.modelValid);
  const [submitted, setSubmitted] = useState<ContentSearchSubmission | null>(
    null,
  );
  const submittedKey = useRef("");

  // 关键词住在地址里，作用域换一次就重新提交一次。
  useEffect(() => {
    if (!query) {
      submittedKey.current = "";
      setSubmitted(null);
      return;
    }
    // 先等模型状态：可用时同时查画面与文字，不可用时至少还能查文字。
    if (!statusQuery.isSuccess && !statusQuery.isError) return;
    const key = `${query}|${embeddingReady}`;
    if (submittedKey.current === key) return;
    submittedKey.current = key;
    setSubmitted({
      request: {
        kind: "photo",
        ...(embeddingReady
          ? { text: query, ocrText: query, matchMode: "any" as const }
          : { ocrText: query }),
      },
      token: Date.now(),
    });
  }, [query, embeddingReady, statusQuery.isError, statusQuery.isSuccess]);

  // 重新搜索：换一个提交时刻，查询键因此不会复用上一次的缓存。
  const resubmit = () => {
    if (!query) return;
    setSubmitted((current) =>
      current ? { ...current, token: Date.now() } : current,
    );
  };

  return (
    <div className="page-shell page-section">
      {status && !embeddingReady ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-meta text-fg-muted">
          <span>
            本机画面模型未就绪，这次只能按图片里的文字找。
          </span>
          <Link to="/tasks/storage" className="btn btn-sm btn-outline">
            查看任务中心
          </Link>
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={resubmit}
          disabled={!query || !submitted}
        >
          重新搜索
        </button>
        {status ? (
          <span className="text-meta text-fg-subtle tabular-nums">
            {status.coverage.indexed.toLocaleString()} /{" "}
            {status.coverage.total.toLocaleString()} 张已索引
          </span>
        ) : null}
      </div>
      <ContentSearchResults
        submitted={submitted}
        status={status}
        statusError={statusQuery.isError}
        wantsSemantic
        onRetry={resubmit}
        idleTitle="输入关键词开始搜索"
        idleDescription="同一个词同时检索画面内容与图片文字，任一命中就会显示。"
      />
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
    const type =
      node.kind === "collection"
        ? collectionTypeWord(node.contentKind ?? mode)
        : hit.virtual
          ? "散图"
          : "";
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
    subtitle: hit.virtual
      ? "散图"
      : isAlbum
        ? hit.tags?.join(" · ")
        : collectionTypeWord(hit.contentKind ?? mode),
    count: hit.count,
    coverPath: hit.coverImage ?? "",
    coverVersion: hit.coverImageVersion,
    to: albumRoute(mode, hit.path),
    contentKind: hit.contentKind ?? mode,
  };
}
