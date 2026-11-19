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
import { usePhotoStore, wallTargetHeight } from "../store/photoStore";
import PhotoWall from "../components/wall/PhotoWall";
import PhotoViewer from "../components/wall/PhotoViewer";
import PhotoCompare from "../components/wall/PhotoCompare";
import PhotoSelectionBar from "../components/wall/PhotoSelectionBar";
import ContextMenu from "../components/album/ContextMenu";
import EmptyState from "../components/common/EmptyState";
import { useWallViewer } from "../hooks/useWallViewer";
import { usePhotoCompare } from "../hooks/usePhotoCompare";
import { useContextMenu } from "../hooks/useContextMenu";
import { FolderIcon, GridIcon, PickIcon, UncheckIcon } from "../components/common/Icon";
import { albumRoute, homeRoute } from "../utils/path";
import { photoCopy } from "../utils/workbench";

/**
 * 精选照片页。
 *
 * 精选是跨相册的：用户在好几本相册里挑出的照片摆在一起。相册级
 * 收藏回答「哪些相册值得留着」，这一页回答「哪些照片值得留着」。
 *
 * 这里的墙与相册里的照片墙是同一个组件 —— 排布规则、密度档位、
 * 悬停信息层都一致，用户不需要学第二套。
 */
/**
 * 精选照片页。
 *
 * `embedded` 时不渲染页头：它被嵌在「我的」的页签里，页头由外层给。
 */
export default function Picks({ embedded = false }: { embedded?: boolean } = {}) {
  const copy = photoCopy();
  const pushToast = useUIStore((s) => s.pushToast);
  const navigate = useNavigate();
  const density = usePhotoStore((s) => s.density);
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

  // 帮助浮层跟着页面走：这一页是照片墙的另一种形态，
  // 该列出的是照片墙与大图预览的那一组操作。
  const setHelpContext = useUIStore((s) => s.setHelpContext);
  useEffect(() => {
    setHelpContext("photo");
    return () => setHelpContext("library");
  }, [setHelpContext]);

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
        .then(() => pushToast({ kind: "success", message: "已移出精选" }))
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
  const selectedEntries = useMemo(
    () => Object.values(selection),
    [selection],
  );
  const isPicked = picks.isPicked;
  const selectedPickedCount = useMemo(
    () => selectedEntries.filter((entry) => isPicked(entry.id)).length,
    [isPicked, selectedEntries],
  );

  const toSelectionEntry = useCallback((item: PickItem): PhotoSelectionEntry => ({
    id: item.id,
    name: item.name,
    albumId: item.albumId,
    albumName: item.albumName,
    kind: item.kind,
    version: item.version,
    width: item.width,
    height: item.height,
  }), []);

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
        pushToast({ kind: "success", message: `已把 ${ids.length} 张移出精选` }),
      )
      .catch(() => pushToast({ kind: "error", message: "移出精选失败" }))
      .finally(() => usePhotoSelectionStore.getState().setBusy(false));
  }, [picks, pushToast]);

  const loadMore = useCallback(() => {
    void query.fetchNextPage({ cancelRefetch: false });
  }, [query]);

  const viewer = wall.viewer;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {embedded ? null : (
      <header className="shrink-0 border-b border-border-faint bg-bg">
        <div className="page-shell">
          <div className="album-bar">
            <div className="min-w-0 flex-1">
              {/* 眉标说清这一页是什么：精选是跨相册的挑选，
                  与相册级收藏不是一回事。 */}
              <p className="page-eyebrow">跨相册挑选</p>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h1 className="album-bar__title truncate">{title}</h1>
                <div className="album-bar__meta tabular-nums">
                  <span>
                    <span className="text-fg font-medium">{total}</span> 张
                  </span>
                  {picks.total !== total && (
                    <>
                      <span className="text-fg-subtle">·</span>
                      <span>
                        共{" "}
                        <span className="text-fg font-medium">
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
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  selectionActive
                    ? "bg-brand/15 text-brand"
                    : "text-fg-muted hover:bg-bg-subtle hover:text-fg"
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
        {/* 嵌在「我的」里时页头由外层给：精选有多少张要说在这页上 ——
            收藏与最近浏览的页签都报「共 N 项」，精选只摆照片会显得
            像漏了计数。 */}
        {embedded && items.length > 0 ? (
          <p className="pb-3 text-meta text-fg-muted tabular-nums">
            共 {total} 张精选照片
          </p>
        ) : null}
        {query.isError && items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-body text-fg-muted">
            精选加载失败，请重试。
          </div>
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
        ) : (
          <PhotoWall
            items={items}
            total={total}
            targetHeight={wallTargetHeight(density)}
            hasNextPage={query.hasNextPage ?? false}
            isLoadingMore={query.isFetchingNextPage}
            onLoadMore={loadMore}
            onOpen={(_item, index) => wall.open(index)}
            /* 精选页的照片来自不同相册：悬停信息层说清出处，
               用户才知道自己看的是哪本里的哪一张。 */
            albumLabel={(item) => item.albumName}
            selecting={selectionActive}
            isSelected={isSelected}
            onToggleSelect={(item) => toggleSelect(item)}
            isPicked={picks.isPicked}
            onTogglePick={(item) => picks.toggle(item.id)}
            /* 关掉预览后墙回到刚才看的那张：翻了几百张再关掉，
               不该把人丢回墙的顶上。 */
            scrollToIndex={wall.focusIndex}
            onContextMenu={menu.open}
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
          ]}
          onSelect={(id) => {
            const item = menu.menu!.item;
            menu.close();
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
                  pushToast({ kind: "success", message: "已移出精选" }),
                )
                .catch(() =>
                  pushToast({ kind: "error", message: "移出精选失败" }),
                );
            }
          }}
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
