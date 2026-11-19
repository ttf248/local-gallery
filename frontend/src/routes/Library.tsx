import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import AlbumGrid from "../components/album/AlbumGrid";
import { SelectionToggle } from "../components/album/BulkActions";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";
import { ListFilterBar } from "../components/common/ListFilterBar";
import FolderTree from "../components/library/FolderTree";
import { FolderOpenIcon } from "../components/common/Icon";
import { useAppMode } from "../hooks/useAppMode";
import { useLibraryList } from "../hooks/useLibraryList";
import {
  useLibraryAncestors,
  useLibraryManifest,
  useLibraryNodes,
} from "../hooks/useLibrary";
import { useListFilters } from "../hooks/useListFilters";
import type { ViewKey } from "../utils/listFilterParams";
import { useUIStore } from "../store/uiStore";
import { decodeFavPath, libraryRoute } from "../utils/path";
import { workbenchCopy } from "../utils/workbench";
import "../styles/library.css";

/** 图库页自己的地址参数。 */
const LIBRARY_PARAM = {
  /** 当前所在的集合 id（空 = 顶层）。 */
  node: "node",
} as const;

/**
 * 图库（照片侧）/ 书架（漫画侧）。
 *
 * 这一页回答的是「库里有这些文件，它们在哪儿」。它展示的是磁盘上真实
 * 存在的目录结构 —— 左侧是媒体根、集合与相册的树，右侧是当前这一层的
 * 内容。智能主题（时间、人物、地点、场景的聚合）是另一回事，在探索页，
 * 不在这里：拿自动分组冒充文件夹树，用户就找不到自己的文件。
 *
 * 状态住在地址里：当前目录、排序、最少张数、视图都是查询参数，刷新不丢，
 * 复制链接能直接落到同一个文件夹。
 */
export default function Library() {
  const { mode } = useAppMode();
  const copy = workbenchCopy(mode);
  const [params, setParams] = useSearchParams();
  const nodeId = params.get(LIBRARY_PARAM.node) ?? "";
  const [treeOpen, setTreeOpen] = useState(false);
  const filters = useListFilters();
  const viewMode = useUIStore((s) => s.viewMode);
  const manifest = useLibraryManifest().data?.manifest;

  const query = useMemo(
    () => ({
      kind: mode,
      parent: nodeId || undefined,
      view: filters.view,
      q: filters.query || undefined,
      sort: filters.sortBy,
      minImageCount: filters.minImageCount,
    }),
    [mode, nodeId, filters.view, filters.query, filters.sortBy, filters.minImageCount],
  );

  const list = useLibraryList(query, Boolean(manifest));
  const nodes = useLibraryNodes(nodeId ? [nodeId] : []);
  const current = nodes.data?.items[0];

  // 集合卡在图库里指向它的下一层，而不是跳到集合页：图库是结构页，
  // 在它里面换目录比跳出去再跳回来短。相册卡仍然指向照片墙。
  //
  // 换的是「点下去去哪里」，不是「这份内容是什么」：集合的规范地址
  // 仍然是作品页 —— 收藏、属性、复制链接、在文件管理器里打开都要靠它
  // 认出这是哪一个集合。
  const cards = useMemo(
    () =>
      list.cards.map((card) =>
        card.variant === "collection"
          ? {
              ...card,
              linkTo: `${libraryRoute(mode)}?${LIBRARY_PARAM.node}=${encodeURIComponent(
                decodeFavPath(card.to),
              )}`,
            }
          : card,
      ),
    [list.cards, mode],
  );

  const selectNode = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set(LIBRARY_PARAM.node, id);
    else next.delete(LIBRARY_PARAM.node);
    setParams(next, { replace: false });
    setTreeOpen(false);
  };

  // 顶层时标题是「全部相册」：页头已经写了「图库」这个栏目名，
  // 再写一遍「图库」就成了同一个词出现在屏幕上两次。
  const title = current
    ? current.displayName || current.name
    : mode === "comic"
      ? "全部作品"
      : "全部相册";
  const total = list.summary?.total ?? 0;
  const hasContent = (manifest?.statistics.albumCount ?? 0) > 0;
  const hasActiveFilters =
    Boolean(filters.query) ||
    filters.view !== "all" ||
    filters.minImageCount > 0;

  return (
    <div className="library-page min-h-full">
      <div className="page-shell">
        {/* 页头：这一层是什么、在哪棵树上。 */}
        <header className="library-head">
          <div className="min-w-0">
            <p className="page-eyebrow">{mode === "comic" ? "书架" : "图库"}</p>
            <h1 className="page-title page-title--sm truncate">{title}</h1>
            {nodeId ? (
              <Breadcrumb
                mode={mode}
                nodeId={nodeId}
                currentName={current ? current.displayName || current.name : ""}
                onSelect={selectNode}
              />
            ) : null}
          </div>
          <div className="library-head__actions">
            {/* 窄屏：目录是一块可展开的面板，展开后它盖在内容上方 ——
                触摸设备没有 hover，目录不能只在悬停时才出现。 */}
            <button
              type="button"
              className="btn btn-sm btn-outline lg:hidden"
              onClick={() => setTreeOpen((v) => !v)}
              aria-expanded={treeOpen}
              aria-controls="library-tree"
            >
              <FolderOpenIcon size={14} />
              目录
            </button>
          </div>
        </header>
      </div>

      <div className="page-shell">
        <div className="library-layout">
          <aside
            id="library-tree"
            className={`library-tree-panel${treeOpen ? " is-open" : ""}`}
          >
            <FolderTree
              mode={mode}
              selectedId={nodeId}
              onSelect={selectNode}
            />
          </aside>

          <div className="library-content min-w-0">
            {list.isError ? (
              <ErrorBanner onRetry={() => void list.refetch()} retrying={list.isFetching}>
                图库内容读取失败。
                {cards.length > 0 ? "仍显示已加载的内容。" : "请重试加载。"}
              </ErrorBanner>
            ) : null}

            {hasContent ? (
              <ListFilterBar
                viewChips={
                  nodeId
                    ? undefined
                    : [
                        { key: "all", label: "全部", count: list.summary?.counts.all },
                        {
                          key: "album",
                          label: copy.albumTypeLabel,
                          count: list.summary?.counts.album,
                        },
                        {
                          key: "collection",
                          label: copy.collectionTypeLabel,
                          count: list.summary?.counts.collection,
                        },
                        { key: "smart", label: "标签", count: list.summary?.counts.smart },
                      ]
                }
                activeViewKey={filters.view}
                onChangeView={(key) => filters.setView(key as ViewKey)}
                filterQuery={filters.query}
                onClearQuery={() => filters.setQuery("")}
                onClearFilters={hasActiveFilters ? filters.reset : undefined}
                totalCount={total}
                sort={filters.sortBy}
                onSortChange={filters.setSortBy}
                minImageCount={filters.minImageCount}
                onMinImageCountChange={filters.setMinImageCount}
                /* 多选：图库一屏几十本相册，逐本收藏不现实。 */
                trailing={<SelectionToggle />}
              />
            ) : null}

            {list.isLoading && cards.length === 0 ? (
              <p className="text-body text-fg-muted py-8">正在读取目录…</p>
            ) : null}

            {cards.length > 0 ? (
              <AlbumGrid
                selectable
                items={cards}
                variant={viewMode}
                onEndReached={() => {
                  if (list.hasNextPage && !list.isFetchingNextPage) {
                    void list.fetchNextPage();
                  }
                }}
              />
            ) : null}

            {!list.isLoading && cards.length === 0 && hasContent ? (
              <EmptyState
                title={filters.query ? "没有匹配的内容" : "这一层是空的"}
                description={
                  filters.query
                    ? `这个目录里没有名字包含「${filters.query}」的相册或集合。`
                    : "这个目录下面没有相册。换一个目录看看，或者回到顶层。"
                }
                action={
                  nodeId ? (
                    <button className="btn btn-outline" onClick={() => selectNode("")}>
                      回到顶层
                    </button>
                  ) : undefined
                }
              />
            ) : null}

            {!hasContent && !list.isLoading ? (
              <EmptyState
                title={`${mode === "comic" ? "书架" : "图库"}这边还没有内容`}
                description="媒体库里还没有这一侧的内容。先到设置里添加媒体目录，或去另一边看看。"
                action={
                  <Link className="btn btn-outline" to="/settings/data">
                    去设置
                  </Link>
                }
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 面包屑：这一层在目录树的哪条路上。
 *
 * 祖先集合逐级向上解析（节点摘要带 parentId，拿到上级才知道再上一级是谁）。
 * 顶层集合没有上级集合，这时用它的媒体根名收尾 —— 多根扫描时，
 * 「同一个叫『2011年』的文件夹」分属不同的根，用户需要知道自己站在哪一棵上。
 */
function Breadcrumb({
  mode,
  nodeId,
  currentName,
  onSelect,
}: {
  mode: "photo" | "comic";
  nodeId: string;
  currentName: string;
  onSelect: (id: string) => void;
}) {
  // 祖先链：节点摘要带 parentId，拿到上级才知道再上一级是谁。
  const ancestors = useLibraryAncestors(nodeId);
  const chain = ancestors.data ?? [];
  const rootName = chain[0]?.sourceName ?? "";

  return (
    <nav aria-label="目录位置" className="library-crumbs">
      <Link
        to={libraryRoute(mode)}
        className="library-crumbs__link"
        onClick={(event) => {
          if (nodeId) {
            event.preventDefault();
            onSelect("");
          }
        }}
      >
        {mode === "comic" ? "书架" : "图库"}
      </Link>
      {rootName ? (
        <>
          <span className="library-crumbs__sep" aria-hidden>
            ›
          </span>
          <span className="library-crumbs__current">{rootName}</span>
        </>
      ) : null}
      {chain.map((item) => (
        <span key={item.id} className="contents">
          <span className="library-crumbs__sep" aria-hidden>
            ›
          </span>
          <Link
            to={`${libraryRoute(mode)}?node=${encodeURIComponent(item.id)}`}
            className="library-crumbs__link"
          >
            {item.displayName || item.name}
          </Link>
        </span>
      ))}
      {currentName ? (
        <>
          <span className="library-crumbs__sep" aria-hidden>
            ›
          </span>
          <span className="library-crumbs__current">{currentName}</span>
        </>
      ) : null}
    </nav>
  );
}
