import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link, useNavigate } from "react-router-dom";
import AlbumGrid, { type CardData } from "../components/album/AlbumGrid";
import BulkActions, { SelectionToggle } from "../components/album/BulkActions";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";
import { ListFilterBar } from "../components/common/ListFilterBar";
import FolderTree from "../components/library/FolderTree";
import { FolderOpenIcon, ReaderIcon } from "../components/common/Icon";
import { useAppMode } from "../hooks/useAppMode";
import { useLibraryList } from "../hooks/useLibraryList";
import {
  useLibraryAncestors,
  useLibraryDashboard,
  useLibraryManifest,
  useLibraryNodes,
} from "../hooks/useLibrary";
import { useGalleryContextSync } from "../hooks/useGalleryContextSync";
import { useListFilters } from "../hooks/useListFilters";
import type { ViewKey } from "../utils/listFilterParams";
import { useUIStore } from "../store/uiStore";
import { decodeFavPath, libraryRoute, readerRoute } from "../utils/path";
import type { GalleryContextEntry } from "../utils/galleryContext";
import type { LibraryDashboardProgress } from "../api/library";
import { workbenchCopy } from "../utils/workbench";
import { toSelectionItems } from "../utils/selectionItems";
import "../styles/library.css";

/** 图库页自己的地址参数。 */
const LIBRARY_PARAM = {
  /** 当前所在的媒体根或集合 id（空 = 所有根）。 */
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
  const navigate = useNavigate();
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
  const currentRoot = manifest?.roots.find((root) => root.id === nodeId);

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

  // 书架按作品陈列。
  //
  // 作品（集合）与卷（相册）在磁盘上是同一层的兄弟：把它们摊平在一张
  // 网格里，读起来是一堆混在一起的目录 —— 「星海镖师」「番外 第05话」
  // 「龙族」并排站着，谁也不知道谁是谁的一部分。分层摆开，层级就说
  // 清楚了：上面一排是书，下面一排是没归入任何作品的散卷。
  const isComicShelf = mode === "comic" && !nodeId;
  const workCards = isComicShelf
    ? cards.filter((card) => card.variant === "collection")
    : [];
  const looseCards = isComicShelf
    ? cards.filter((card) => card.variant === "album")
    : [];
  const tagCards = isComicShelf
    ? cards.filter((card) => card.variant === "smart")
    : [];

  // 在读摘要按作品分组：这一部读到哪儿了写在作品卡上，而不是让用户
  // 点进去逐卷翻。同一作品有多卷在读时取最近更新的那卷。
  const dashboard = useLibraryDashboard();
  const resumeByWork = useMemo(() => {
    const map = new Map<string, LibraryDashboardProgress>();
    for (const entry of dashboard.data?.dashboard.inProgress ?? []) {
      const parentId = entry.album.parentId;
      if (!parentId) continue;
      const previous = map.get(parentId);
      if (!previous || entry.updated > previous.updated) {
        map.set(parentId, entry);
      }
    }
    return map;
  }, [dashboard.data]);

  const resumeOf = useCallback(
    (card: CardData) => resumeByWork.get(decodeFavPath(card.to)),
    [resumeByWork],
  );

  // 「继续读」：从书架一步进到读到一半的那一卷。
  //
  // 不带 index 进阅读器：阅读器会自己按服务端记录恢复页码，硬塞一个
  // 页码反而把它顶掉。
  const workOverlayAction = useCallback(
    (card: CardData) => {
      const entry = resumeOf(card);
      if (!entry) return null;
      const volumeName = entry.album.displayName || entry.album.name;
      return (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            navigate(readerRoute(entry.album.id));
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm ring-1 ring-white/20 transition-colors hover:bg-black/80"
          title={`继续读「${volumeName}」`}
          aria-label={`继续读「${volumeName}」`}
        >
          <ReaderIcon size={13} />
        </button>
      );
    },
    [navigate, resumeOf],
  );

  const workNote = useCallback(
    (card: CardData) => {
      const entry = resumeOf(card);
      if (!entry) return null;
      return `在读 · ${entry.album.displayName || entry.album.name}`;
    },
    [resumeOf],
  );

  // 取下一页：整页一次算清。
  //
  // 分页是整页的事，不能只挂在某一段网格上 —— 页面被分成几段之后，
  // 末尾那一段不一定是被滚到的那一段，取页的触发也就落空了。
  const loadMore = useCallback(() => {
    if (list.hasNextPage && !list.isFetchingNextPage) {
      void list.fetchNextPage();
    }
  }, [list]);

  // 批量选择的条目：整页一次算清，动作条也只出现一次。
  const selectionItems = useMemo(() => toSelectionItems(cards), [cards]);

  // 跨卷导航的上下文：这一层的可见条目。
  //
  // 书架是选卷的地方，也是阅读器「上一卷 / 下一卷」的来路。少了它，
  // 从书架点开的一卷读完后无处可去；「读完自动切下一卷」也因此失效。
  const contextEntries = useMemo<GalleryContextEntry[]>(
    () =>
      cards.map((card) => ({
        key: decodeFavPath(card.to),
        to: card.to,
        name: card.title,
        parentName: card.parentName,
        // 作品没有阅读器入口：跳卷时必须跳过它。
        kind: card.variant === "collection" ? "collection" : "album",
        imageCount: card.imageCount,
        videoCount: card.videoCount,
        contentKind: card.contentKind,
      })),
    [cards],
  );
  useGalleryContextSync(
    { type: "collection", parentPath: nodeId },
    contextEntries,
    undefined,
    { query: list.query, nextCursor: list.nextCursor },
  );

  // 顶层时标题是「全部相册」：页头已经写了「图库」这个栏目名，
  // 再写一遍「图库」就成了同一个词出现在屏幕上两次。
  const title = current
    ? current.displayName || current.name
    : currentRoot?.name || (mode === "comic" ? "全部作品" : "全部相册");
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
                rootName={currentRoot?.name}
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
              isComicShelf ? (
                /* 书架：作品一排，没归入作品的散卷一排，标签一排。
                   分段摆开，层级才读得出来。 */
                <>
                  {/* 批量动作条只出现一次，覆盖整页已加载的条目。 */}
                  <BulkActions loaded={selectionItems} />
                  {workCards.length > 0 ? (
                    <section className="mb-10">
                      <div className="section-heading">
                        <h2 className="section-title">作品</h2>
                        <span className="section-meta tabular-nums">
                          {workCards.length} 部
                        </span>
                      </div>
                      <AlbumGrid
                        selectable
                        showBulkActions={false}
                        items={workCards}
                        variant={viewMode}
                        overlayAction={workOverlayAction}
                        note={workNote}
                        onEndReached={loadMore}
                      />
                    </section>
                  ) : null}

                  {looseCards.length > 0 ? (
                    <section className="mb-10">
                      <div className="section-heading">
                        <h2 className="section-title">未归入作品</h2>
                        <span className="section-meta tabular-nums">
                          {looseCards.length} 卷
                        </span>
                      </div>
                      <AlbumGrid
                        selectable
                        showBulkActions={false}
                        items={looseCards}
                        variant={viewMode}
                        onEndReached={loadMore}
                      />
                    </section>
                  ) : null}

                  {tagCards.length > 0 ? (
                    <section className="mb-10">
                      <div className="section-heading">
                        <h2 className="section-title">标签</h2>
                        <span className="section-meta tabular-nums">
                          {tagCards.length} 个
                        </span>
                      </div>
                      <AlbumGrid
                        items={tagCards}
                        variant={viewMode}
                        onEndReached={loadMore}
                      />
                    </section>
                  ) : null}
                </>
              ) : (
                <AlbumGrid
                  selectable
                  items={cards}
                  variant={viewMode}
                  onEndReached={loadMore}
                />
              )
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
  rootName: selectedRootName,
  currentName,
  onSelect,
}: {
  mode: "photo" | "comic";
  nodeId: string;
  rootName?: string;
  currentName: string;
  onSelect: (id: string) => void;
}) {
  // 祖先链：节点摘要带 parentId，拿到上级才知道再上一级是谁。
  const ancestors = useLibraryAncestors(nodeId);
  const chain = ancestors.data ?? [];
  const rootName = selectedRootName || chain[0]?.sourceName || "";

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
      {chain.slice(0, -1).map((item) => (
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
