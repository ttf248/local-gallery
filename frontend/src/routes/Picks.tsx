import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { picksApi, type PickItem } from "../api/picks";
import { usePickToggle } from "../hooks/usePickToggle";
import { useUIStore } from "../store/uiStore";
import {
  usePhotoSelectionStore,
  type PhotoSelectionEntry,
} from "../store/photoSelectionStore";
import PhotoMasonry from "../features/wall/PhotoMasonry";
import PickShowcase from "../features/collection/PickShowcase";
import PhotoViewer from "../features/viewer/PhotoViewer";
import PhotoCompare from "../features/viewer/PhotoCompare";
import PhotoSelectionBar from "../features/common/PhotoSelectionActions";
import { ContextMenu } from "../ui/ContextMenu";
import { EmptyState } from "../ui/EmptyState";
import ErrorBanner from "../features/common/ErrorBanner";
import { useWallViewer } from "../hooks/useWallViewer";
import { usePhotoCompare } from "../hooks/usePhotoCompare";
import { useContextMenu } from "../hooks/useContextMenu";
import { FolderIcon, GridIcon, PickIcon, UncheckIcon } from "../ui/icons";
import { albumRoute, homeRoute } from "../utils/path";
import { photoCopy } from "../utils/workbench";
import { captureDateLabel, captureDateSourceLabel } from "../utils/date";

/**
 * 精选照片页。
 *
 * 精选是跨相册的：用户在好几本相册里挑出的照片摆在一起。相册级
 * 收藏回答「哪些相册值得留着」，这一页回答「哪些照片值得留着」。
 *
 * 精选少到几张时摆成陈列（见 PickShowcase）：每张一个框，按自己的
 * 比例完整地摆出来。多起来换成自然照片墙（瀑布流）：相册里的照片墙
 * 会裁切凑行，那是给「一整本几千张」用的 —— 挑出来的照片被裁掉半张脸，
 * 这一页就没有意义了。
 */

/** 精选少到多少张时改用陈列摆法。 */
const SHOWCASE_LIMIT = 4;

/**
 * 精选照片页。
 *
 * `embedded` 时不渲染页头：它被嵌在「我的」的页签里，页头由外层给。
 */
export default function Picks({
  embedded = false,
  onSummary,
}: { embedded?: boolean; onSummary?: (label: string) => void } = {}) {
  const copy = photoCopy();
  const pushToast = useUIStore((s) => s.pushToast);
  const navigate = useNavigate();
  const picks = usePickToggle();

  // 右键菜单：精选页的照片来自不同相册，用户常要跳回原来那本看看上下文。
  const menu = useContextMenu<PickItem>();
  // 并排对比：先放一张进「待对比」，再对另一张按 C 就并排打开。
  const compare = usePhotoCompare((item) => item.albumName ?? "");

  const query = useInfiniteQuery({
    queryKey: ["picks", "media"],
    queryFn: async ({ pageParam }) => {
      const response = await picksApi.media(pageParam);
      return response.page;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const {
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = query;

  const items = useMemo<PickItem[]>(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? items.length;

  const title = copy.picksTitle;

  // 大图预览：下标、翻页与「关掉后回到刚才那张」只有一份实现。
  const wall = useWallViewer({
    items,
    total,
    albumName: (item) => item.albumName || title,
    albumHref: (item) => albumRoute("photo", item.albumId ?? ""),
    isPicked: () => true,
    onTogglePick: (item) => {
      void picks
        .remove([item.id])
        .then(() =>
          pushToast({
            kind: "success",
            message: "已移出精选",
            action: {
              label: "撤销",
              onClick: () => {
                void picks
                  .add([item.id])
                  .catch(() =>
                    pushToast({ kind: "error", message: "恢复精选失败" }),
                  );
              },
            },
          }),
        )
        .catch(() => pushToast({ kind: "error", message: "操作失败" }));
    },
  });

  // 多选：作用域是这一页。
  const selectionScope = "picks";
  const selection = usePhotoSelectionStore((s) => s.entries);
  const selectionActive = usePhotoSelectionStore((s) => s.active);
  const selectionBusy = usePhotoSelectionStore((s) => s.busy);
  useEffect(() => {
    usePhotoSelectionStore.getState().ensureScope(selectionScope);
  }, [selectionScope]);
  const selectedEntries = useMemo(() => Object.values(selection), [selection]);
  const isPicked = picks.isPicked;
  const selectedPickedCount = useMemo(
    () => selectedEntries.filter((entry) => isPicked(entry.id)).length,
    [isPicked, selectedEntries],
  );

  const toSelectionEntry = useCallback(
    (item: PickItem): PhotoSelectionEntry => ({
      id: item.id,
      name: item.name,
      albumId: item.albumId,
      albumName: item.albumName,
      kind: item.kind,
      version: item.version,
      width: item.width,
      height: item.height,
    }),
    [],
  );

  const toggleSelect = useCallback(
    (item: PickItem) => {
      const state = usePhotoSelectionStore.getState();
      if (state.busy) return;
      // 返回 false 有两种原因：已经在上限上，或者正忙。
      // 只有前者值得提示，后者不该打扰用户。
      if (!state.toggle(toSelectionEntry(item)) && !state.entries[item.id]) {
        pushToast({ kind: "info", message: "最多选择 2,000 张，请减少范围" });
      }
    },
    [pushToast, toSelectionEntry],
  );

  // 读订阅到的选择集合而不是 store 的当前值：勾选变化时墙要重画。
  const isSelected = useCallback(
    (id: string) => Boolean(selection[id]),
    [selection],
  );

  const removeSelectedFromPicks = useCallback(() => {
    const state = usePhotoSelectionStore.getState();
    if (state.busy) return;
    const ids = Object.values(state.entries).map((entry) => entry.id);
    if (ids.length === 0) return;
    state.setBusy(true);
    void picks
      .remove(ids)
      .then(() =>
        pushToast({
          kind: "success",
          message: `已把 ${ids.length} 张移出精选`,
        }),
      )
      .catch(() => pushToast({ kind: "error", message: "移出精选失败" }))
      .finally(() => usePhotoSelectionStore.getState().setBusy(false));
  }, [picks, pushToast]);

  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError]);

  const viewer = wall.viewer;

  /* 少量精选换一种摆法。
     照片墙是给「很多张」用的：密排、裁切、按固定行高铺满。挑出来的三五张
     用它排会缩在左边一角，竖幅还被裁掉半张 —— 用户挑出来的照片是拿来
     好好看的，不是拿来数的。数量少的时候摆成陈列：每张一个框，完整地
     摆出来，几个框并排摆开、整体居中。 */
  const summary = query.data
    ? total.toLocaleString("zh-CN") + " 张精选"
    : undefined;
  useEffect(() => {
    if (summary) onSummary?.(summary);
  }, [onSummary, summary]);
  const showcase = total > 0 && total <= SHOWCASE_LIMIT;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {embedded ? null : (
        <header className="shrink-0 border-b border-line bg-canvas">
          <div className="page-shell">
            <div className="album-bar flex items-center gap-3.5 py-3 max-sm:flex-wrap">
              <div className="min-w-0 flex-1">
                {/* 眉标说清这一页是什么：精选是跨相册的挑选，
                  与相册级收藏不是一回事。 */}
                <p className="page-eyebrow flex items-center gap-2 text-primary text-caption font-semibold tracking-[0.02em]">跨相册挑选</p>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h1 className="album-bar__title font-display text-title leading-[1.25] font-semibold tracking-[-0.02em] text-ink [overflow-wrap:anywhere] truncate">{title}</h1>
                  <div className="album-bar__meta flex flex-wrap items-baseline gap-y-0.5 gap-x-2.5 mt-1 text-caption text-ink-2 [.album-bar_&]:mt-0 tabular-nums">
                    <span>
                      <span className="text-ink font-medium">{total}</span> 张
                    </span>
                    {picks.total !== total && (
                      <>
                        <span className="text-ink-3">·</span>
                        <span>
                          共{" "}
                          <span className="text-ink font-medium">
                            {picks.total}
                          </span>{" "}
                          张在精选
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const state = usePhotoSelectionStore.getState();
                    if (state.active) state.clear();
                    else state.start();
                  }}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    selectionActive
                      ? "bg-primary/15 text-primary"
                      : "text-ink-2 hover:bg-sunken hover:text-ink"
                  }`}
                  aria-pressed={selectionActive}
                >
                  <PickIcon size={14} />
                  <span className="hidden sm:inline">
                    {selectionActive ? "退出选择" : "选择"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </header>
      )}

      <div className="page-shell min-h-0 flex-1 pb-2">
        {query.isError && items.length > 0 ? (
          <div className="pb-2">
            <ErrorBanner
              kind="warning"
              onRetry={() =>
                query.isFetchNextPageError
                  ? void query.fetchNextPage({ cancelRefetch: false })
                  : void query.refetch()
              }
              retrying={query.isFetching}
            >
              {query.isFetchNextPageError
                ? "后续精选照片加载失败，已加载的照片仍可浏览。"
                : "精选列表更新失败，仍保留已加载的照片。"}
            </ErrorBanner>
          </div>
        ) : null}
        {query.isError && items.length === 0 ? (
          <EmptyState
            title="精选加载失败"
            description="检查服务或网络后，可以重新读取精选照片。"
            action={
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => void query.refetch()}
                disabled={query.isFetching}
              >
                重试加载
              </button>
            }
          />
        ) : items.length === 0 && !query.isLoading ? (
          <EmptyState
            title={copy.picksEmpty}
            description="在照片墙里把满意的照片加入精选，它们会聚到这里。"
            icon={<PickIcon size={20} />}
            /* 空态要给一条能走的路：精选是在照片墙里挑出来的，
               按钮直接把人送到照片库。 */
            action={
              <button
                className="btn btn-outline"
                onClick={() => navigate(homeRoute("photo"))}
              >
                去照片库
              </button>
            }
          />
        ) : showcase ? (
          <PickShowcase
            items={items}
            onOpen={(index) => wall.open(index)}
            /* 精选页摆的每张都在精选里：角标就是移出精选的入口。 */
            onTogglePick={(item) =>
              void picks
                .remove([item.id])
                .then(() =>
                  pushToast({
                    kind: "success",
                    message: "已移出精选",
                    action: {
                      label: "撤销",
                      onClick: () => {
                        void picks
                          .add([item.id])
                          .catch(() =>
                            pushToast({
                              kind: "error",
                              message: "恢复精选失败",
                            }),
                          );
                      },
                    },
                  }),
                )
                .catch(() =>
                  pushToast({ kind: "error", message: "移出精选失败" }),
                )
            }
            name={(item) => item.name}
            /* 精选页的照片来自不同相册：出处要写在照片下面，
               用户才知道自己看的是哪本里的哪一张。 */
            source={(item) => item.albumName}
            /* 日期比文件名有信息量：文件名是文件系统里的编号，
               日期是这张照片发生的事。拿不出拍摄证据就不写。 */
            date={(item) => captureDateLabel(item.dateValue, item.dateSource)}
            dateHint={(item) =>
              captureDateSourceLabel(item.dateSource) || undefined
            }
            /* 框按照片自己的形状长：竖幅不该被裁成横幅。 */
            ratio={(item) =>
              item.width && item.height ? item.width / item.height : undefined
            }
            selecting={selectionActive}
            isSelected={isSelected}
            onToggleSelect={(item) => toggleSelect(item)}
            onContextMenu={menu.open}
          />
        ) : (
          /* 多张精选：一面自然照片墙。
             相册里的照片墙会裁切凑行 —— 那是给「一整本几千张」用的，
             精选是用户挑出来的那几张，裁掉半张脸就毁了它。 */
          <PhotoMasonry
            items={items}
            targetColumnWidth={260}
            gap={12}
            onOpen={(_item, index) => wall.open(index)}
            /* 精选页的照片来自不同相册：悬停信息层说清出处，
               用户才知道自己看的是哪本里的哪一张。 */
            albumLabel={(item) => item.albumName}
            selecting={selectionActive}
            isSelected={isSelected}
            onToggleSelect={(item) => toggleSelect(item)}
            isPicked={picks.isPicked}
            onTogglePick={(item) => picks.toggle(item.id)}
            onContextMenu={menu.open}
            /* 关掉预览后墙回到刚才看的那张：翻了几百张再关掉，
               不该把人丢回墙的顶上。 */
            scrollToIndex={wall.focusIndex}
            hasNextPage={query.hasNextPage ?? false}
            isLoadingMore={query.isFetchingNextPage}
            loadMoreError={query.isFetchNextPageError}
            onLoadMore={loadMore}
            /* 像素尺寸是技术读数：精选页的照片是拿来好好看的。 */
            showDimensions={false}
          />
        )}
      </div>

      {menu.menu && (
        <ContextMenu
          x={menu.menu.x}
          y={menu.menu.y}
          items={[
            {
              id: "open",
              label: "查看大图",
              icon: <GridIcon size={12} />,
            },
            {
              id: "album",
              label: "在相册中打开",
              icon: <FolderIcon size={12} />,
            },
            {
              id: "unpick",
              label: "移出精选",
              icon: <UncheckIcon size={12} />,
            },
          ].map((action) => ({
            ...action,
            onSelect: () => {
              const id = action.id;

              const item = menu.menu!.item;

              if (id === "open") {
                const index = items.findIndex((it) => it.id === item.id);
                if (index >= 0) wall.open(index);
                return;
              }
              if (id === "album") {
                navigate(albumRoute("photo", item.albumId));
                return;
              }
              if (id === "unpick") {
                void picks
                  .remove([item.id])
                  .then(() =>
                    pushToast({
                      kind: "success",
                      message: "已移出精选",
                      action: {
                        label: "撤销",
                        onClick: () => {
                          void picks
                            .add([item.id])
                            .catch(() =>
                              pushToast({
                                kind: "error",
                                message: "恢复精选失败",
                              }),
                            );
                        },
                      },
                    }),
                  )
                  .catch(() =>
                    pushToast({ kind: "error", message: "移出精选失败" }),
                  );
              }
            },
          }))}
          onClose={menu.close}
        />
      )}

      {selectionActive && (
        <PhotoSelectionBar
          selected={selectedEntries}
          pickedCount={selectedPickedCount}
          onAddPicks={() => {
            /* 这一页的每张都在精选里，「加入精选」不会露出来。 */
          }}
          onRemovePicks={removeSelectedFromPicks}
          onCompare={compare.compareSelected}
          onExit={() => usePhotoSelectionStore.getState().clear()}
          busy={selectionBusy}
        />
      )}

      {viewer && (
        <PhotoViewer
          {...viewer}
          /* 精选页的照片来自不同相册：标题给当前这张的出处，
             用户才知道自己看的是哪本里挑出来的。 */
          comparePinned={compare.pin?.id === items[viewer.index]?.id}
          compareOpen={compare.pair !== null}
          onToggleCompare={() => {
            const item = items[viewer.index];
            if (item) compare.togglePin(item);
          }}
        />
      )}

      {compare.pair && (
        <PhotoCompare
          left={compare.pair[0]}
          right={compare.pair[1]}
          leftPicked={picks.isPicked(compare.pair[0].id)}
          rightPicked={picks.isPicked(compare.pair[1].id)}
          onClose={compare.close}
          onSwap={compare.swap}
        />
      )}
    </div>
  );
}
