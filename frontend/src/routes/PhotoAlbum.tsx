import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  LibraryMediaItem,
  LibraryNodeSummary,
  LibraryPage,
} from "../api/library";
import { albumPageExtras } from "../api/library";
import { albumsApi } from "../api/albums";
import { similarityApi } from "../api/similarity";
import { libraryQueryKeys } from "../api/queryKeys";
import { useAlbumFilters, useAlbumMedia } from "../hooks/useLibrary";
import {
  smartAlbumQueryKeys,
  useSmartAlbumGroupMedia,
  useSmartAlbumGroups,
} from "../hooks/useSmartAlbums";
import { useFavorites } from "../hooks/useFavorites";
import { usePicks } from "../hooks/usePicks";
import { useAlbumActions } from "../hooks/useAlbumActions";
import { useWallViewer } from "../hooks/useWallViewer";
import { usePhotoCompare } from "../hooks/usePhotoCompare";
import { useContextMenu } from "../hooks/useContextMenu";
import { useAlbumViewState } from "../hooks/useAlbumViewState";
import { useAlbumAnalysis } from "../hooks/useAlbumAnalysis";
import { useAlbumSelection } from "../hooks/useAlbumSelection";
import { useUIStore } from "../store/uiStore";
import { usePhotoStore, wallTargetHeight } from "../store/photoStore";
import { usePhotoSelectionStore } from "../store/photoSelectionStore";
import PhotoWall from "../components/wall/PhotoWall";
import AlbumFilterBar from "../components/wall/AlbumFilterBar";
import ErrorBanner from "../components/common/ErrorBanner";
import EmptyState from "../components/common/EmptyState";
import PhotoViewer from "../components/wall/PhotoViewer";
import PhotoCompare from "../components/wall/PhotoCompare";
import PhotoSelectionBar from "../components/wall/PhotoSelectionBar";
import AlbumHeader from "../components/album/AlbumHeader";
import AlbumGroupPanel from "../components/album/AlbumGroupPanel";
import AlbumMediaMenu from "../components/album/AlbumMediaMenu";
import PropertiesDialog from "../components/common/PropertiesDialog";
import { CloseIcon } from "../components/common/Icon";
import { fileManagerErrorMessage } from "../utils/fileManager";
import { useSafeBack, contextFallback } from "../utils/navigation";
import { albumRoute } from "../utils/path";
import { albumFilterChips } from "../utils/albumFilter";

interface Props {
  /** 相册摘要（含内容用途与封面）。 */
  album: LibraryNodeSummary;
}

/**
 * 照片相册页：打开即是照片墙。
 *
 * 与漫画阅读器是两条完全不同的路径：这里没有页码、没有双页、没有阅读
 * 进度，只做「平铺浏览 → 点开大图」。相册级操作（收藏、封面、类型切换）
 * 收在顶部工具条，不再占用一整屏的封面区。
 *
 * 这一页只有一套内容：这本相册里的照片。分组（按时间、人物、地点、场景）
 * 是同一批照片的一种看法，不是另一本相册 —— 分组面板开着时墙上仍然是
 * 这本相册的照片，选一组只是先看那一组。
 */
export default function PhotoAlbum({ album }: Props) {
  // 返回：应用内还有历史就回退；深链直接打开这一本时回到它所属的文件夹，
  // 归属不明就回相册页。回到那一侧的首页会把用户丢到离内容最远的地方。
  const goBack = useSafeBack(() =>
    contextFallback(album.contentKind ?? "photo", album.parentId),
  );
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const density = usePhotoStore((s) => s.density);
  const setDensity = usePhotoStore((s) => s.setDensity);
  // 媒体根数量：单根时不必在页头上重复来源。
  const multiRoot = useUIStore((s) => s.multiRoot);
  const [filterOpen, setFilterOpen] = useState(false);

  // 视图状态住在地址栏：筛选条件、分组维度与选中的分组。
  const view = useAlbumViewState();
  const {
    filter,
    setFilter,
    clearFilter,
    filterCount,
    dimension,
    setDimension,
    groupId,
    setGroupId,
  } = view;

  const { toggle: toggleFav, favorites } = useFavorites();
  const isFavorite = favorites.includes(album.id);

  const title = album.virtual
    ? album.location || album.displayName || album.name
    : album.displayName || album.name;

  // 分组：开着分组面板时，墙上可能是这一组，也可能是全部照片。
  const grouping = dimension !== null;
  const showingGroup = grouping && groupId !== null;

  const rawMediaQuery = useAlbumMedia(album.id, undefined, !showingGroup, filter);
  const albumFiltersQuery = useAlbumFilters(album.id, !showingGroup && filterOpen);
  const smartGroupsQuery = useSmartAlbumGroups(
    album.id,
    dimension ?? "recommended",
    grouping,
  );
  const smartSummary = smartGroupsQuery.data?.summary;
  const selectedGroup =
    smartSummary?.groups.find((group) => group.id === groupId) ?? null;
  const smartGroupMediaQuery = useSmartAlbumGroupMedia(
    album.id,
    dimension ?? "recommended",
    groupId ?? "",
    smartSummary?.snapshotKey ?? "",
  );
  const mediaQuery = showingGroup ? smartGroupMediaQuery : rawMediaQuery;

  const mediaItems = useMemo<LibraryMediaItem[]>(() => {
    // 原始照片墙与分组两边的页结构不同，但媒体项是同一种。
    const pages = (mediaQuery.data?.pages ??
      []) as LibraryPage<LibraryMediaItem>[];
    return pages.flatMap((page) => page.items);
  }, [mediaQuery.data]);
  const mediaPage = mediaQuery.data?.pages[0];
  const total = mediaPage?.total ?? mediaItems.length;
  const extras = useMemo(() => albumPageExtras(mediaPage), [mediaPage]);
  const facets = albumFiltersQuery.data?.facets;
  /* 相册里的照片数（不含视频）：视频不参与分析类筛选，
     计数因此与筛选条上的口径一致。 */
  const photoCount = Math.max(0, extras.albumTotal - extras.videoTotal);
  /* 墙上现在摆着几张照片：视频不参与分析类筛选，折叠也只对照片生效，
     拿媒体总数充数会让计数与页头对不上。 */
  const wallPhotoCount = extras.photoTotal || photoCount;
  const unresolved = extras.unresolved;
  const filterChips = useMemo(
    () => albumFilterChips(filter, facets),
    [filter, facets],
  );
  const expandedGroupId = filter.expand ?? null;

  const analysis = useAlbumAnalysis({ albumId: album.id, dimension });
  const selection = useAlbumSelection({ albumId: album.id, albumName: title });

  useEffect(() => {
    if (smartSummary && !smartSummary.cacheHit) {
      void queryClient.invalidateQueries({
        queryKey: smartAlbumQueryKeys.directoryRoot,
      });
    }
  }, [queryClient, smartSummary]);

  // 分组被重建或隐藏之后，原先选中的那一组可能已经不在了：退回全部照片。
  useEffect(() => {
    if (
      grouping &&
      groupId &&
      smartSummary &&
      !smartSummary.groups.some((group) => group.id === groupId)
    ) {
      setGroupId(null);
    }
  }, [groupId, grouping, setGroupId, smartSummary]);

  // 右键菜单：照片墙上的图片同样能查看属性、在文件管理器中定位。
  const menu = useContextMenu<LibraryMediaItem>();
  const [propertiesFileId, setPropertiesFileId] = useState<string | null>(null);

  // 精选：照片级的标记，与相册级收藏是两份数据。
  const { isPicked, mergeServerFlags, toggle: togglePickState } = usePicks();

  const actions = useAlbumActions({
    id: "a:" + album.id,
    variant: "album",
    title,
    subtitle: (album.tags ?? []).join(" · "),
    count: album.imageCount ?? 0,
    coverPath: album.coverImage ?? "",
    coverVersion: album.coverImageVersion,
    coverKind: album.coverKind ?? "image",
    to: albumRoute("photo", album.id),
    isFavorite,
  });

  // 照片墙的帮助浮层多一组大图预览的操作；离开本页时复位。
  const setHelpContext = useUIStore((s) => s.setHelpContext);
  useEffect(() => {
    setHelpContext("photo");
    return () => setHelpContext("library");
  }, [setHelpContext]);

  const loadMore = useCallback(() => {
    void mediaQuery.fetchNextPage({ cancelRefetch: false });
  }, [mediaQuery]);

  const copyLink = useCallback(async () => {
    try {
      await actions.copyLink();
      pushToast({ kind: "success", message: "已复制链接", ttl: 1200 });
    } catch {
      pushToast({ kind: "error", message: "复制失败，请检查浏览器权限" });
    }
  }, [actions, pushToast]);

  const openInExplorer = useCallback(async () => {
    try {
      await actions.openInExplorer();
      pushToast({ kind: "success", message: "已请求打开目录", ttl: 1200 });
    } catch (error: unknown) {
      pushToast({ kind: "error", message: fileManagerErrorMessage(error) });
    }
  }, [actions, pushToast]);

  const toggleFavorite = useCallback(() => {
    void toggleFav(album.id)
      .then(() =>
        pushToast({
          kind: "success",
          message: isFavorite ? "已取消收藏" : "已加入收藏",
        }),
      )
      .catch(() => pushToast({ kind: "error", message: "操作失败" }));
  }, [album.id, isFavorite, pushToast, toggleFav]);

  // 服务端在媒体项上标了精选：集合还没回来时先把这些并进去，
  // 免得照片先画出来、精选标记过一会儿才补上。
  useEffect(() => {
    mergeServerFlags(mediaItems);
  }, [mediaItems, mergeServerFlags]);

  const togglePick = useCallback(
    (item: LibraryMediaItem) => {
      void togglePickState(item.id).catch(() =>
        pushToast({ kind: "error", message: "精选操作失败" }),
      );
    },
    [pushToast, togglePickState],
  );

  /* 相似组：点一下代表照片上的角标，这一组的成员就地摊开在墙上；
     再点一下收回去。展开与折叠都写在地址栏里，刷新与后退都跟着走。 */
  const toggleGroup = useCallback(
    (groupId: string) => {
      if (expandedGroupId === groupId) {
        setFilter({ ...filter, collapse: true, expand: undefined });
        return;
      }
      setFilter({ ...filter, collapse: true, expand: groupId });
    },
    [expandedGroupId, filter, setFilter],
  );

  /* 换代表照片：这是用户自己的决定，写进相似照片的人工决定里。
     改完要重取这一页的媒体，墙上的角标与折叠才对得上。 */
  const setRepresentative = useCallback(
    async (groupId: string, resourceId: string) => {
      try {
        await similarityApi.update(groupId, { representative: resourceId });
        void queryClient.invalidateQueries({
          queryKey: libraryQueryKeys.media(album.id),
        });
        pushToast({ kind: "success", message: "已更换代表照片" });
      } catch {
        pushToast({ kind: "error", message: "更换代表照片失败" });
      }
    },
    [album.id, pushToast, queryClient],
  );

  /* 墙上的相似组角标。它只在「这一组在本相册里不止一张」时出现 ——
     一张照片单独一组，说不出「相似」是什么意思。 */
  const itemOverlay = useCallback(
    (item: LibraryMediaItem) => {
      const group = item.similarityGroup;
      if (!group || group.albumSize < 2) return null;
      if (group.shown !== item.id) {
        // 展开的成员：标出它跟代表照片是同一组。
        if (expandedGroupId !== group.id) return null;
        return (
          <span className="pointer-events-none absolute right-1.5 top-1.5 z-10 rounded-md bg-black/70 px-1.5 py-0.5 text-meta text-white/90 backdrop-blur">
            同组
          </span>
        );
      }
      const expanded = expandedGroupId === group.id;
      return (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggleGroup(group.id);
          }}
          aria-pressed={expanded}
          title={
            expanded
              ? "收起这一组"
              : `这一组有 ${group.albumSize} 张相似的照片，点开就地比较`
          }
          className={`hover-reveal absolute right-1.5 top-1.5 z-10 rounded-md bg-black/70 px-1.5 py-0.5 text-meta text-white/90 backdrop-blur transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white group-hover:opacity-100 group-focus-within:opacity-100 ${
            expanded ? "opacity-100" : ""
          }`}
        >
          {expanded ? "收起这组" : `${group.albumSize} 张相似`}
        </button>
      );
    },
    [expandedGroupId, toggleGroup],
  );

  // 大图预览：下标、翻页与「关掉后回到刚才那张」只有一份实现。
  const wall = useWallViewer({
    items: mediaItems,
    total,
    albumName: () => title,
    /* 这一页的每一张都出自这本相册：最近浏览据此记它。 */
    albumId: album.id,
    /* 连续浏览：相册里的照片是分页取的，翻到已加载的末尾时
       自动接下一页，而不是停在两百张。 */
    hasNextPage: mediaQuery.hasNextPage ?? false,
    isLoadingMore: mediaQuery.isFetchingNextPage,
    loadMoreError: mediaQuery.isFetchNextPageError,
    onLoadMore: loadMore,
    isPicked,
    onTogglePick: togglePick,
  });
  const viewer = wall.viewer;

  const setCover = useCallback(async () => {
    const item = wall.index === null ? undefined : mediaItems[wall.index];
    if (!item) return;
    try {
      await albumsApi.setCover(album.id, item.id);
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      pushToast({ kind: "success", message: "已设为封面" });
    } catch {
      pushToast({ kind: "error", message: "设置封面失败" });
    }
  }, [album.id, mediaItems, pushToast, queryClient, wall.index]);

  const compare = usePhotoCompare(() => title);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {mediaQuery.isFetchNextPageError && (
        <ErrorBanner
          kind="warning"
          className="shrink-0"
          onRetry={loadMore}
          retrying={mediaQuery.isFetchingNextPage}
        >
          后续媒体加载失败，已加载内容仍可浏览。
        </ErrorBanner>
      )}
      <AlbumHeader
        album={album}
        title={title}
        multiRoot={multiRoot}
        density={density}
        onDensityChange={setDensity}
        selectionActive={selection.active}
        onToggleSelection={selection.toggleMode}
        isFavorite={isFavorite}
        onToggleFavorite={toggleFavorite}
        canOpenInExplorer={actions.canOpenInExplorer}
        onOpenInExplorer={() => void openInExplorer()}
        onCopyLink={() => void copyLink()}
        onBack={goBack}
      >
        <nav
          aria-label="相册视图"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-faint py-2"
        >
          {/* 分组：这本相册的另一种看法，不是另一本相册。
              按下它面板开着，墙上还是这本相册里的照片。 */}
          <button
            type="button"
            onClick={() => setDimension(grouping ? null : "recommended")}
            className="chip"
            aria-pressed={grouping}
          >
            {grouping ? "分组浏览已开" : "按分组浏览"}
          </button>
          {showingGroup && selectedGroup ? (
            <span className="truncate text-meta text-fg-muted">
              分组：{selectedGroup.name} · {selectedGroup.photoCount} 张
            </span>
          ) : null}
          {showingGroup ? (
            <button
              type="button"
              onClick={() => setGroupId(null)}
              className="btn-text text-meta text-brand hover:underline"
            >
              回到全部照片
            </button>
          ) : null}
          {/* 筛选条只在看全部照片时出现：分组里的照片已经是筛过的，
              再加一层筛选会让人以为那些分组还能再筛。 */}
          {!showingGroup ? (
            <div className="ml-auto">
              <AlbumFilterBar
                state={filter}
                facets={facets}
                facetsLoading={albumFiltersQuery.isLoading}
                facetsError={albumFiltersQuery.isError}
                retryingFacets={albumFiltersQuery.isFetching}
                onRetryFacets={() => void albumFiltersQuery.refetch()}
                filterOpen={filterOpen}
                onFilterOpenChange={setFilterOpen}
                resultCount={wallPhotoCount}
                photoCount={photoCount}
                unresolved={unresolved}
                grouped={extras.grouped}
                groupedGroups={extras.groupedGroups}
                onChange={setFilter}
                onClear={clearFilter}
              />
            </div>
          ) : null}
        </nav>
        {/* 生效的条件逐条摆出来：条件能组合，用户不必回到面板里
            再点一次才能去掉其中一条。 */}
        {!showingGroup && filterChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border-faint py-1.5">
            {filterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilter(chip.clear)}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-bg-subtle px-2 text-meta text-fg transition-colors hover:bg-bg-strong"
                title={`去掉这条条件：${chip.label}`}
              >
                {chip.label}
                <CloseIcon size={11} />
              </button>
            ))}
          </div>
        )}
      </AlbumHeader>

      {grouping ? (
        <AlbumGroupPanel
          summary={smartSummary}
          loading={smartGroupsQuery.isLoading}
          error={smartGroupsQuery.isError}
          dimension={dimension ?? "recommended"}
          groupId={groupId}
          /* 这本相册自己的照片数：选中某一组时，墙上换成那一组，
             「全部照片」那一条仍要说整本有多少张。 */
          totalPhotos={album.imageCount ?? 0}
          onDimensionChange={setDimension}
          onOpenGroup={setGroupId}
          onClose={() => setDimension(null)}
          analyzing={analysis.analyzing}
          rebuilding={analysis.rebuilding}
          peopleEnabled={analysis.peopleEnabled}
          onAnalyze={() => void analysis.analyzeAlbum()}
          onAnalyzeDimension={(type) => void analysis.analyzeDimension(type)}
          onRebuild={() => void analysis.rebuild()}
          onSaveOverride={analysis.saveOverride}
          modules={analysis.modules}
          jobs={analysis.jobs}
        />
      ) : null}

      <div className="page-shell min-h-0 flex-1 pb-2">
        {/* 只有第一页就没加载出来才整页报错：后续分页失败时已加载的内容
            仍然能翻，页头的提示条已经说明了失败与重试。 */}
        {mediaQuery.isError && mediaItems.length === 0 ? (
          <EmptyState
            title="媒体加载失败"
            description="这一本相册暂时读不出来。"
            action={
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => void mediaQuery.refetch()}
              >
                重新加载
              </button>
            }
          />
        ) : mediaQuery.isLoading && !mediaQuery.data ? (
          <div
            className="page-shell py-10 text-center text-body text-fg-muted"
            aria-live="polite"
          >
            正在读取相册媒体…
          </div>
        ) : mediaItems.length === 0 && mediaQuery.data ? (
          filterCount > 0 ? (
            <EmptyState
              title="没有符合筛选条件的照片"
              description="当前筛选条件没有匹配的照片。"
              action={
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={clearFilter}
                >
                  清除筛选
                </button>
              }
            />
          ) : (
            <EmptyState
              title="相册里还没有媒体"
              description="这本相册里暂时没有可浏览的照片或视频。"
            />
          )
        ) : (
          <PhotoWall
            items={mediaItems}
            total={total}
            targetHeight={wallTargetHeight(density)}
            hasNextPage={mediaQuery.hasNextPage ?? false}
            isLoadingMore={mediaQuery.isFetchingNextPage}
            onLoadMore={loadMore}
            onOpen={(_item, index) => wall.open(index)}
            selecting={selection.active}
            isSelected={selection.isSelected}
            onToggleSelect={selection.toggle}
            isPicked={isPicked}
            onTogglePick={togglePick}
            itemOverlay={itemOverlay}
            scrollToIndex={wall.focusIndex}
            onContextMenu={menu.open}
          />
        )}
      </div>

      {selection.active && (
        <PhotoSelectionBar
          selected={selection.entries}
          pickedCount={selection.pickedCount}
          onAddPicks={selection.addToPicks}
          onRemovePicks={selection.removeFromPicks}
          onCompare={compare.compareSelected}
          onExit={() => usePhotoSelectionStore.getState().clear()}
          busy={selection.busy}
        />
      )}

      {menu.menu && (
        <AlbumMediaMenu
          x={menu.menu.x}
          y={menu.menu.y}
          item={menu.menu.item}
          picked={isPicked(menu.menu.item.id)}
          canOpenInExplorer={actions.canOpenInExplorer}
          onClose={menu.close}
          onSelect={(action, item) => {
            menu.close();
            if (action === "open") {
              const index = mediaItems.findIndex((it) => it.id === item.id);
              if (index >= 0) wall.open(index);
              return;
            }
            if (action === "pick") {
              togglePick(item);
              return;
            }
            if (action === "cover") {
              setPropertiesFileId(null);
              void albumsApi
                .setCover(album.id, item.id)
                .then(() => {
                  void queryClient.invalidateQueries({ queryKey: ["library"] });
                  pushToast({ kind: "success", message: "已设为封面" });
                })
                .catch(() =>
                  pushToast({ kind: "error", message: "设置封面失败" }),
                );
              return;
            }
            if (action === "properties") setPropertiesFileId(item.id);
            if (action === "copy") void copyLink();
            if (action === "explorer") void openInExplorer();
            if (action === "representative" && item.similarityGroup) {
              void setRepresentative(item.similarityGroup.id, item.id);
            }
          }}
        />
      )}

      <PropertiesDialog
        target={
          propertiesFileId ? { kind: "image", id: propertiesFileId } : null
        }
        onClose={() => setPropertiesFileId(null)}
      />

      {viewer && (
        <PhotoViewer
          {...viewer}
          isFavorite={isFavorite}
          onToggleFavorite={toggleFavorite}
          onSetCover={() => void setCover()}
          hasCustomCover={album.hasCustomCover}
          comparePinned={compare.pin?.id === mediaItems[viewer.index]?.id}
          compareOpen={compare.pair !== null}
          onToggleCompare={() => {
            const item = mediaItems[viewer.index];
            if (item) compare.togglePin(item);
          }}
        />
      )}

      {compare.pair && (
        <PhotoCompare
          left={compare.pair[0]}
          right={compare.pair[1]}
          leftPicked={isPicked(compare.pair[0].id)}
          rightPicked={isPicked(compare.pair[1].id)}
          onClose={compare.close}
          onSwap={compare.swap}
        />
      )}
    </div>
  );
}
