import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link, useNavigate } from "react-router-dom";
import AlbumGrid, { type CardData } from "../components/album/AlbumGrid";
import BulkActions, { SelectionToggle } from "../components/album/BulkActions";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";
import { ListFilterBar } from "../components/common/ListFilterBar";
import FolderTree from "../components/library/FolderTree";
import FolderDrawer, {
  useFolderDrawer,
} from "../components/library/FolderDrawer";
import BreadcrumbMenu from "../components/library/BreadcrumbMenu";
import {PageHeader} from "../shell/PageHeader";
import { FilterDropdown } from "../components/wall/AlbumFilterBar";
import type { ReactNode } from "react";
import {
  ChevronLeftIcon,
  FolderOpenIcon,
  ReaderIcon,
} from "../ui/icons";
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

/** 相册页自己的地址参数。 */
const LIBRARY_PARAM = {
  /** 当前所在的媒体根或集合 id（空 = 所有根）。 */
  node: "node",
} as const;

/**
 * 相册（照片侧）/ 书架（漫画侧）。
 *
 * 这一页回答的是「库里有这些文件，它们在哪儿」。它展示的是磁盘上真实
 * 存在的目录结构 —— 左侧是媒体根、集合与相册的树，右侧是当前这一层的
 * 内容。智能主题（时间、人物、地点、场景的聚合）是另一回事，在发现页，
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
  const drawer = useFolderDrawer();
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
    [
      mode,
      nodeId,
      filters.view,
      filters.query,
      filters.sortBy,
      filters.minImageCount,
    ],
  );

  const list = useLibraryList(query, Boolean(manifest));
  const nodes = useLibraryNodes(nodeId ? [nodeId] : []);
  const current = nodes.data?.items[0];
  const currentRoot = manifest?.roots.find((root) => root.id === nodeId);
  // 祖先链：面包屑与「返回上级」共用一份。链上最后一段是当前节点，
  // 倒数第二段就是上一级 —— 顶层文件夹的上一级是「所有根」。
  const ancestors = useLibraryAncestors(nodeId);
  const ancestorChain = ancestors.data ?? [];
  const parentId =
    ancestorChain.length > 1 ? ancestorChain[ancestorChain.length - 2].id : "";

  // 文件夹卡在相册页里指向它的下一层，而不是跳去集合页：相册页是结构页，
  // 在它里面换目录比跳出去再跳回来短。相册卡仍然指向照片墙。
  //
  // 换的是「点下去去哪里」，不是「这份内容是什么」：文件夹的规范地址
  // 仍然是集合页 —— 收藏、属性、复制链接、在文件管理器里打开都要靠它
  // 认出这是哪一个文件夹。
  const cards = useMemo(
    () =>
      list.cards.map((card) =>
        card.variant === "collection"
          ? {
              ...card,
              linkTo: `${libraryRoute(mode)}?${LIBRARY_PARAM.node}=${encodeURIComponent(
                decodeFavPath(card.to),
              )}`,
              // 照片侧的文件夹卡封面上已经压着「文件夹」角标：说明行
              // 再写一遍是同一句话说两遍。
              subtitle: mode === "photo" ? undefined : card.subtitle,
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
    if (!drawer.desktop) drawer.setOpen(false);
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

  // 顶层标题跟着视图走：这一层摆的是相册、集合还是标签，标题就说哪一种。
  //
  // 「全部相册」曾经是顶层的唯一说法，可默认视图（全部）里摆着集合与
  // 标签 —— 标题与内容对不上，用户会以为集合没列出来。漫画侧同理：
  // 书架顶层摆着作品、散卷与标签，说它是「全部作品」也不对。
  const scopeTitle = useMemo(() => {
    switch (filters.view) {
      case "album":
        return `全部${copy.albumTypeLabel}`;
      case "collection":
        return `全部${copy.collectionTypeLabel}`;
      case "smart":
        return "全部标签";
      default:
        return "全部内容";
    }
  }, [copy.albumTypeLabel, copy.collectionTypeLabel, filters.view]);
  // 顶层时标题自己就说清了范围（全部……）；往下一层，标题是这一层的
  // 名字，位置由面包屑说明 —— 两边都不必再挂一个栏目眉标。
  const title = current
    ? current.displayName || current.name
    : (currentRoot?.name ?? scopeTitle);
  const total = list.summary?.total ?? 0;
  const hasContent = (manifest?.statistics.albumCount ?? 0) > 0;
  const hasActiveFilters =
    Boolean(filters.query) ||
    filters.view !== "all" ||
    filters.minImageCount > 0;

  const actions = hasContent ? (
    <ListFilterBar
      compact
      hideTotalCount
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
              {
                key: "smart",
                label: "标签",
                count: list.summary?.counts.smart,
              },
            ]
      }
      activeViewKey={filters.view}
      onChangeView={(key) => filters.setView(key as ViewKey)}
      totalCount={total}
      sort={filters.sortBy}
      onSortChange={filters.setSortBy}
      minImageCount={filters.minImageCount}
      onMinImageCountChange={filters.setMinImageCount}
      /* 多选：一屏几十本相册，逐本收藏不现实。 */
      trailing={<SelectionToggle />}
    />
  ) : null;

  return (
    <div className="library-page min-h-full">
      <div className="page-shell"><PageHeader
  title={title}
  meta={list.summary ? `${total.toLocaleString("zh-CN")} 项` : undefined}
  actions={
          drawer.desktop
            ? actions
            : actions && <LibraryFilters>{actions}</LibraryFilters>
        }
  toolbar={
          hasActiveFilters && (
            <div className="flex flex-wrap gap-1.5">
              {filters.query && (
                <button
                  type="button"
                  className="ui-chip"
                  onClick={() => filters.setQuery("")}
                  aria-label={`清除名称筛选「${filters.query}」`}
                >
                  名称 · {filters.query} <span aria-hidden>×</span>
                </button>
              )}
              <button type="button" className="ui-chip" onClick={filters.reset}>
                清除筛选
              </button>
            </div>
          )
        }
  eyebrow={<div className="flex items-center gap-2">{
          <>
            <button
              ref={drawer.triggerRef}
              type="button"
              className="toolbar-icon"
              title="切换目录抽屉"
              aria-label="目录"
              aria-keyshortcuts={"Control+\\ Meta+\\"}
              aria-expanded={drawer.open}
              aria-controls={drawer.open ? "library-tree" : undefined}
              onClick={() => drawer.setOpen(!drawer.open)}
            >
              <FolderOpenIcon size={17} />
            </button>
            {nodeId && (
              <button
                type="button"
                className="toolbar-icon"
                aria-label="返回上级"
                title="返回上级"
                onClick={() => selectNode(parentId)}
              >
                <ChevronLeftIcon size={16} />
              </button>
            )}
          </>
        } {
          nodeId && (
            <BreadcrumbMenu
              mode={mode}
              nodeId={nodeId}
              roots={(manifest?.roots ?? []).filter(
                (root) => (root.contentKind ?? "photo") === mode,
              )}
              chain={ancestorChain}
              onSelect={selectNode}
            />
          )
        }</div>}
/></div>
      <div className="page-shell library-layout">
        <FolderDrawer
          open={drawer.open}
          desktop={drawer.desktop}
          triggerRef={drawer.triggerRef}
          onClose={() => {
            drawer.setOpen(false);
            if (drawer.desktop) drawer.triggerRef.current?.focus();
          }}
        >
          <FolderTree mode={mode} selectedId={nodeId} onSelect={selectNode} />
        </FolderDrawer>
        <div className="library-content min-w-0">
          {list.isError ? (
            <ErrorBanner
              onRetry={() => void list.refetch()}
              retrying={list.isFetching}
            >
              {mode === "comic" ? "书架" : "相册"}内容读取失败。
              {cards.length > 0 ? "仍显示已加载的内容。" : "请重试加载。"}
            </ErrorBanner>
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
                coverRatio={mode === "photo" ? "4/3" : "4/5"}
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
                  ? `这个目录里没有名字包含「${filters.query}」的${copy.albumTypeLabel}或${copy.collectionTypeLabel}。`
                  : `这个目录下面没有${copy.albumTypeLabel}。换一个目录看看，或者回到顶层。`
              }
              action={
                nodeId ? (
                  <button
                    className="btn btn-outline"
                    onClick={() => selectNode("")}
                  >
                    回到顶层
                  </button>
                ) : undefined
              }
            />
          ) : null}

          {!hasContent && !list.isLoading ? (
            <EmptyState
              title={`${mode === "comic" ? "书架" : "相册"}这边还没有内容`}
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
  );
}

function LibraryFilters({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <FilterDropdown
      label="显示与排序"
      dialogLabel="相册显示与排序"
      count={0}
      open={open}
      onOpenChange={setOpen}
      panel={children}
    />
  );
}
