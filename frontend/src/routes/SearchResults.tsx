import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import AlbumGrid from "../features/library/AlbumGrid";
import EmptyState from "../features/common/EmptyState";
import ErrorBanner from "../features/common/ErrorBanner";
import {PageHeader} from "../shell/PageHeader";
import Segmented from "../ui/Segmented";
import { albumsApi, type SearchHit } from "../api/albums";
import type { LibraryNodeSummary } from "../api/library";
import { useLibraryNodes } from "../hooks/useLibrary";
import { useAppMode } from "../hooks/useAppMode";
import { useContentScope } from "../hooks/useContentScope";
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
import { searchMatchLabel } from "../utils/searchMatch";
import type { CardData } from "../features/library/AlbumTile";
import ContentSearchResults from "../components/search/ContentSearchResults";

const SEARCH_PAGE_SIZE = 100;

/** 一组结果：同一个命中理由下的所有卡片。 */
interface ResultGroup {
  key: string;
  /** 命中理由；没有理由时（不该有）不写标题。 */
  label: string | undefined;
  items: CardData[];
}

/**
 * 搜索结果页。
 *
 * 顶栏的搜索框回车落到这里。以前回车只是把关键词塞进地址再回首页，
 * 而首页那一段是智能相册预览 —— 搜出来的相册被一片不相关的推荐盖住了，
 * 用户看不到自己搜到了什么。现在回车进的是一页可见的结果。
 *
 * 一页管两类检索对象：容器的**名字**与照片里的**画面 / 文字**。
 * 两者的检索对象不同，界面上用一个分段控件说清当前是哪一类，
 * 关键词与作用域都住在地址里：刷新、前进、后退都对。
 *
 * 结果本身按命中理由分组：完全同名、开头相同、名字里含有……理由是
 * 分组标题，不写在每一张卡上 —— 同一句话在一屏里重复几十遍，
 * 说明不了任何事。卡片上留给照片、数量与来源。
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
  const isContent = scope === "content";
  const content = useContentScope(query);

  const search = useInfiniteQuery({
    queryKey: ["library", "search", mode, query, SEARCH_PAGE_SIZE],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      albumsApi.search(query, mode, SEARCH_PAGE_SIZE, pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: query.length >= 1 && !isContent,
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

  /**
   * 按命中理由分组。
   *
   * 结果按相关度排，同一种命中理由是连着出现的。理由当分组标题：
   * 一眼能看出「哪几条是完全同名、哪几条只是开头像」，又不用把同一句
   * 话在每张卡上重复一遍。
   */
  const groups = useMemo<ResultGroup[]>(() => {
    const list: ResultGroup[] = [];
    for (const card of cards) {
      const label = matchLabels.get(card.id);
      const last = list[list.length - 1];
      if (last && last.label === label) {
        last.items.push(card);
        continue;
      }
      list.push({
        key: `${label ?? "hit"}-${list.length}`,
        label,
        items: [card],
      });
    }
    return list;
  }, [cards, matchLabels]);

  const setScope = (next: SearchScope) => {
    const nextParams = new URLSearchParams(params);
    if (next === "content") nextParams.set(SEARCH_SCOPE_PARAM, "content");
    else nextParams.delete(SEARCH_SCOPE_PARAM);
    setParams(nextParams, { replace: true });
  };
  const clearConditions = () => {
    setParams(new URLSearchParams(), { replace: true });
  };

  const heading = (
    <div className="page-shell"><PageHeader
  title={query ? `「${query}」的搜索结果` : "搜索"}
  meta={
        query
          ? isContent
            ? "在照片的画面与图片文字里找，按相似度排列。"
            : `在${mode === "comic" ? "漫画" : "照片"}库里按名字找相册、文件夹与标签。`
          : "在顶栏的搜索框里输入关键词，按回车就能看到结果。"
      }
/></div>
  );

  const conditions = (
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
  );

  if (isContent) {
    // 内容结果是一面照片墙：墙要一块确定高度的地方才排得出行。
    // 因此这一档整页是一个定高的 flex 列，与「智能搜索」页同一套骨架。
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 overflow-y-auto pb-4">
          {heading}
          <div className="page-shell">{conditions}</div>
          {/* 技术状态退到一行小字里：索引覆盖率与「重新搜索」是背景信息，
              照片墙才是这一页的主角。 */}
          <div className="page-shell flex flex-wrap items-center gap-3 pt-3">
            {content.status ? (
              <span className="text-meta tabular-nums text-fg-subtle">
                {content.status.coverage.indexed.toLocaleString()} /{" "}
                {content.status.coverage.total.toLocaleString()} 张已索引
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={content.resubmit}
              disabled={!query || !content.submitted}
            >
              重新搜索
            </button>
          </div>
          {content.status && !content.status.runtimeReady ? (
            <div className="page-shell pt-2">
              <p className="text-meta text-fg-muted">
                本机画面模型未就绪，这次只能按图片里的文字找。
                <Link
                  to="/tasks/storage"
                  className="ml-1 text-accent underline-offset-2 hover:underline"
                >
                  查看任务中心
                </Link>
              </p>
            </div>
          ) : null}
        </div>
        <div className="page-shell min-h-0 flex-1 pb-2">
          <ContentSearchResults
            submitted={content.submitted}
            status={content.status}
            statusError={content.statusError}
            wantsSemantic
            onRetry={content.resubmit}
            idleTitle="输入关键词开始搜索"
            idleDescription="同一个词同时检索画面内容与图片文字，任一命中就会显示。"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      {heading}

      <div className="page-shell">{conditions}</div>

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
            </p>
            {groups.map((group) => (
              <section key={group.key} className="mb-5">
                {group.label ? (
                  <h3 className="mb-3 flex items-baseline gap-2">
                    <span className="text-body font-medium text-fg">
                      {group.label}
                    </span>
                    <span className="text-meta tabular-nums text-fg-subtle">
                      {group.items.length} 项
                    </span>
                  </h3>
                ) : null}
                <AlbumGrid
                  items={group.items}
                  variant={viewMode}
                />
              </section>
            ))}
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
    return {
      ...card,
      subtitle: parts.length > 0 ? parts.join(" · ") : card.subtitle,
    };
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
