import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LibraryMediaItem,
  LibraryNodeSummary,
  LibraryPage,
} from "../api/library";
import { albumPageExtras } from "../api/library";
import { albumsApi, type SmartAlbumDimension } from "../api/albums";
import { aiJobsApi, type AnalysisType } from "../api/aiJobs";
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
import { useUIStore } from "../store/uiStore";
import {
  usePhotoSelectionStore,
  type PhotoSelectionEntry,
} from "../store/photoSelectionStore";
import { usePhotoStore, wallTargetHeight } from "../store/photoStore";
import PhotoWall from "../components/wall/PhotoWall";
import DensityControl from "../components/wall/DensityControl";
import AlbumFilterBar from "../components/wall/AlbumFilterBar";
import ErrorBanner from "../components/common/ErrorBanner";
import EmptyState from "../components/common/EmptyState";
import PhotoViewer from "../components/wall/PhotoViewer";
import PhotoCompare from "../components/wall/PhotoCompare";
import PhotoSelectionBar from "../components/wall/PhotoSelectionBar";
import SmartAlbumBrowser from "../components/album/SmartAlbumBrowser";
import ContextMenu, { type AnyMenuItem } from "../components/album/ContextMenu";
import PropertiesDialog from "../components/common/PropertiesDialog";
import Popover, {
  PopoverItem,
  PopoverLabel,
} from "../components/common/Popover";
import {
  ArrowUpRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ImageIcon,
  CopyIcon,
  FolderIcon,
  GridIcon,
  InfoIcon,
  MoreHorizontalIcon,
  PickIcon,
  SelectIcon,
  StarIcon,
  UncheckIcon,
} from "../components/common/Icon";
import { fileManagerErrorMessage } from "../utils/fileManager";
import { useSafeBack } from "../utils/navigation";
import { albumRoute, homeRoute } from "../utils/path";
import { mediaCountParts } from "../utils/mediaCount";
import {
  ALBUM_FILTER_PARAM,
  albumFilterCount,
  albumFilterChips,
  albumFilterParams,
  parseAlbumFilter,
  type AlbumFilterState,
} from "../utils/albumFilter";

interface Props {
  /** 相册摘要（含内容用途与封面）。 */
  album: LibraryNodeSummary;
}

function parseSmartAlbumDimension(value: string | null): SmartAlbumDimension {
  switch (value) {
    case "recommended":
    case "time":
    case "place":
    case "people":
    case "scene":
      return value;
    default:
      return "recommended";
  }
}

/**
 * 照片相册页：打开即是照片墙。
 *
 * 与漫画阅读器是两条完全不同的路径：这里没有页码、没有双页、没有阅读
 * 进度，只做「平铺浏览 → 点开大图」。相册级操作（收藏、封面、类型切换）
 * 收在顶部工具条，不再占用一整屏的封面区。
 */
export default function PhotoAlbum({ album }: Props) {
  const goBack = useSafeBack(homeRoute("photo"));
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const density = usePhotoStore((s) => s.density);
  const setDensity = usePhotoStore((s) => s.setDensity);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterOpen, setFilterOpen] = useState(false);
  const smartMode = searchParams.get("view") === "smart";
  /* 筛选条件住在地址栏里：刷新、复制链接、前进后退都带着它。
     条件是离散的挑选，因此写回地址时不替换历史 —— 用户按一次后退
     就能退回刚才那套条件。 */
  const filter = useMemo(() => parseAlbumFilter(searchParams), [searchParams]);
  const setFilter = useCallback(
    (next: AlbumFilterState) => {
      const params = new URLSearchParams(searchParams);
      for (const key of Object.values(ALBUM_FILTER_PARAM)) params.delete(key);
      albumFilterParams(next).forEach((value, key) => params.set(key, value));
      if (params.toString() !== searchParams.toString()) {
        setSearchParams(params);
      }
    },
    [searchParams, setSearchParams],
  );
  const clearFilter = useCallback(
    () => setFilter({ collapse: filter.collapse }),
    [filter.collapse, setFilter],
  );
  const setSmartMode = useCallback(
    (enabled: boolean) => {
      setFilterOpen(false);
      const next = new URLSearchParams(searchParams);
      if (enabled) next.set("view", "smart");
      else {
        next.delete("view");
        next.delete("dimension");
        next.delete("group");
      }
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );
  const dimension = parseSmartAlbumDimension(searchParams.get("dimension"));
  const selectedGroupId = searchParams.get("group");
  const setDimension = useCallback(
    (nextDimension: SmartAlbumDimension) => {
      const next = new URLSearchParams(searchParams);
      next.set("view", "smart");
      next.set("dimension", nextDimension);
      next.delete("group");
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );
  const setSelectedGroupId = useCallback(
    (groupId: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (groupId === null) next.delete("group");
      else {
        next.set("view", "smart");
        next.set("dimension", dimension);
        next.set("group", groupId);
      }
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
    },
    [dimension, searchParams, setSearchParams],
  );
  const [analyzingJobIds, setAnalyzingJobIds] = useState<string[]>([]);
  const [rebuilding, setRebuilding] = useState(false);
  const { toggle: toggleFav, favorites } = useFavorites();
  const isFavorite = favorites.includes(album.id);
  // 媒体根数量：单根时不必在页头上重复来源。
  const multiRoot = useUIStore((s) => s.multiRoot);

  const rawMediaQuery = useAlbumMedia(album.id, undefined, !smartMode, filter);
  const albumFiltersQuery = useAlbumFilters(album.id, !smartMode && filterOpen);
  const smartGroupsQuery = useSmartAlbumGroups(album.id, dimension, smartMode);
  const smartSummary = smartGroupsQuery.data?.summary;
  const selectedGroup =
    smartSummary?.groups.find((group) => group.id === selectedGroupId) ?? null;
  const smartGroupMediaQuery = useSmartAlbumGroupMedia(
    album.id,
    dimension,
    selectedGroupId ?? "",
    smartSummary?.snapshotKey ?? "",
  );
  const showingSmartGroup = smartMode && selectedGroupId !== null;
  const mediaQuery = showingSmartGroup ? smartGroupMediaQuery : rawMediaQuery;
  const mediaItems = useMemo<LibraryMediaItem[]>(() => {
    // 原始照片墙与智能分组两边的页结构不同，但媒体项是同一种。
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

  useEffect(() => {
    if (smartSummary && !smartSummary.cacheHit) {
      void queryClient.invalidateQueries({
        queryKey: smartAlbumQueryKeys.directoryRoot,
      });
    }
  }, [queryClient, smartSummary]);

  const analysisJobsQuery = useQuery({
    queryKey: ["ai-jobs"],
    queryFn: aiJobsApi.list,
    enabled: smartMode || analyzingJobIds.length > 0,
    refetchInterval: analyzingJobIds.length > 0 ? 2_000 : false,
  });
  const peopleEnabled =
    analysisJobsQuery.data?.snapshot.settings.peopleEnabled ?? false;

  // 右键菜单：照片墙上的图片同样能查看属性、在文件管理器中定位。
  const menu = useContextMenu<LibraryMediaItem>();
  const [propertiesFileId, setPropertiesFileId] = useState<string | null>(null);

  // 精选：照片级的标记，与相册级收藏是两份数据。
  const {
    isPicked,
    mergeServerFlags,
    toggle: togglePickState,
    add: addPicks,
    remove: removePicks,
  } = usePicks();
  // 多选：作用域是这一本相册，换一本相册选择就清空。
  const selectionScope = `album:${album.id}`;
  const selection = usePhotoSelectionStore((s) => s.entries);
  const selectionActive = usePhotoSelectionStore((s) => s.active);
  const selectionBusy = usePhotoSelectionStore((s) => s.busy);
  useEffect(() => {
    usePhotoSelectionStore.getState().ensureScope(selectionScope);
  }, [selectionScope]);
  const selectedEntries = useMemo(() => Object.values(selection), [selection]);
  const selectedPickedCount = useMemo(
    () => selectedEntries.filter((entry) => isPicked(entry.id)).length,
    [isPicked, selectedEntries],
  );

  const title = album.virtual
    ? album.location || album.displayName || album.name
    : album.displayName || album.name;

  // 并排对比：先放一张进「待对比」，再对另一张按 C 就并排打开。
  const compare = usePhotoCompare(() => title);

  useEffect(() => {
    if (
      smartMode &&
      selectedGroupId &&
      smartSummary &&
      !smartSummary.groups.some((group) => group.id === selectedGroupId)
    ) {
      setSelectedGroupId(null);
    }
  }, [selectedGroupId, setSelectedGroupId, smartMode, smartSummary]);

  useEffect(() => {
    const jobs = analysisJobsQuery.data?.snapshot.jobs;
    if (!jobs || analyzingJobIds.length === 0) return;
    const jobsByID = new Map(jobs.map((job) => [job.id, job]));
    const selectedJobs = analyzingJobIds.map((id) => jobsByID.get(id));
    if (
      selectedJobs.some(
        (job) =>
          !job ||
          job.status === "pending" ||
          job.status === "running" ||
          job.status === "paused",
      )
    ) {
      return;
    }
    const failed = selectedJobs.some((job) => job?.status === "failed");
    setAnalyzingJobIds([]);
    void queryClient.invalidateQueries({
      queryKey: ["smart-albums", album.id],
    });
    void queryClient.invalidateQueries({
      queryKey: smartAlbumQueryKeys.directoryRoot,
    });
    pushToast({
      kind: failed ? "info" : "success",
      message: failed
        ? "相册分析已结束，部分任务未完成"
        : "相册分析完成，分组已更新",
    });
  }, [
    album.id,
    analysisJobsQuery.data,
    analyzingJobIds,
    pushToast,
    queryClient,
  ]);

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

  const analyzeAlbum = useCallback(async () => {
    try {
      const result = await aiJobsApi.startAll("incremental", album.id);
      const ids = result.jobs.map((job) => job.id);
      if (ids.length === 0) {
        pushToast({ kind: "info", message: "当前相册没有可启动的分析模块" });
        return;
      }
      setAnalyzingJobIds(ids);
      pushToast({ kind: "success", message: "已加入当前相册的分析队列" });
    } catch {
      pushToast({ kind: "error", message: "分析任务未能启动，请检查任务中心" });
    }
  }, [album.id, pushToast]);

  const analyzeDimension = useCallback(
    async (type: AnalysisType) => {
      try {
        const result = await aiJobsApi.start(type, "incremental", album.id);
        // 追加而不是覆盖：推荐空态可能一次给两个补分析入口，
        // 覆盖会把先启动的那个任务挤出监视范围，结束时不会提示也不会刷新。
        setAnalyzingJobIds((ids) => [...ids, result.job.id]);
        const label =
          type === "face"
            ? "人脸"
            : type === "embedding"
              ? "场景语义"
              : "元数据";
        pushToast({
          kind: "success",
          message: `已加入当前相册的${label}分析队列`,
        });
      } catch {
        pushToast({
          kind: "error",
          message: "分析任务未能启动，请检查任务中心",
        });
      }
    },
    [album.id, pushToast],
  );

  const rebuildSmartGroups = useCallback(async () => {
    setRebuilding(true);
    try {
      const response = await albumsApi.rebuildSmartGroups(album.id, dimension);
      queryClient.setQueryData(
        smartAlbumQueryKeys.summary(album.id, dimension),
        response,
      );
      void queryClient.invalidateQueries({
        queryKey: smartAlbumQueryKeys.directoryRoot,
      });
      setSelectedGroupId(null);
      pushToast({ kind: "success", message: "已按当前分析结果重建分组" });
    } catch {
      pushToast({ kind: "error", message: "分组重建失败，请稍后重试" });
    } finally {
      setRebuilding(false);
    }
  }, [album.id, dimension, pushToast, queryClient, setSelectedGroupId]);

  const saveGroupOverride = useCallback(
    async (groupId: string, override: { name?: string; hidden?: boolean }) => {
      try {
        const response = await albumsApi.updateSmartGroup(
          album.id,
          dimension,
          groupId,
          override,
        );
        queryClient.setQueryData(
          smartAlbumQueryKeys.summary(album.id, dimension),
          response,
        );
        void queryClient.invalidateQueries({
          queryKey: smartAlbumQueryKeys.directoryRoot,
        });
        pushToast({
          kind: "success",
          message:
            override.name !== undefined
              ? "分组名称已保存"
              : override.hidden
                ? "分组已隐藏"
                : "已取消隐藏",
        });
        return true;
      } catch {
        pushToast({ kind: "error", message: "智能分组修改失败" });
        return false;
      }
    },
    [album.id, dimension, pushToast, queryClient],
  );

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

  const toSelectionEntry = useCallback(
    (item: LibraryMediaItem): PhotoSelectionEntry => ({
      id: item.id,
      name: item.name,
      albumId: album.id,
      albumName: title,
      kind: item.kind,
      version: item.version,
      width: item.width,
      height: item.height,
    }),
    [album.id, title],
  );

  const toggleSelect = useCallback(
    (item: LibraryMediaItem) => {
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

  // 提交期间锁住选择：连按两下「加入精选」不必发两次请求。
  const runPickAction = useCallback(
    (action: "add" | "remove") => {
      const state = usePhotoSelectionStore.getState();
      if (state.busy) return;
      const ids = Object.values(state.entries).map((entry) => entry.id);
      if (ids.length === 0) return;
      state.setBusy(true);
      const write = action === "add" ? addPicks(ids) : removePicks(ids);
      void write
        .then(() =>
          pushToast({
            kind: "success",
            message:
              action === "add"
                ? `已把 ${ids.length} 张加入精选`
                : `已把 ${ids.length} 张移出精选`,
          }),
        )
        .catch(() =>
          pushToast({
            kind: "error",
            message: action === "add" ? "加入精选失败" : "移出精选失败",
          }),
        )
        .finally(() => usePhotoSelectionStore.getState().setBusy(false));
    },
    [addPicks, pushToast, removePicks],
  );

  const addSelectedToPicks = useCallback(
    () => runPickAction("add"),
    [runPickAction],
  );

  const removeSelectedFromPicks = useCallback(
    () => runPickAction("remove"),
    [runPickAction],
  );

  const compareSelected = compare.compareSelected;

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
      <header className="shrink-0 border-b border-border-faint bg-bg">
        {/* 照片墙与其它页面的内容左缘保持一致：留白用同一套 gutter，
            宽屏时照片铺满但边缘不跑掉。 */}
        <div className="page-shell">
          <div className="album-bar">
            <button
              type="button"
              onClick={goBack}
              className="btn btn-sm btn-ghost -ml-2 shrink-0"
              aria-label="返回"
            >
              <ChevronLeftIcon size={13} />
              <span className="hidden sm:inline">返回</span>
            </button>

            {/* 标题行：集合 › 相册 › 计数。
                照片墙是浏览页，页头要薄 —— 它占的每一行都是照片的位置。
                身份信息摊在同一行上（左）比堆成两行更省高度，
                也让「这一本在库里的哪个位置」一眼可读。 */}
            <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {/* 这一本在库里的位置：所属集合。散图相册的标题本身就是
                  归属目录，没有第二层可说，就不重复报。
                  集合名是一段路径，不是一段文字：点它回到那个集合，
                  否则从相册里找不到回去的路。 */}
              {album.parentName && (
                <>
                  {album.parentId ? (
                    <Link
                      to={albumRoute("photo", album.parentId)}
                      className="album-bar__crumb inline-flex items-center gap-1 truncate hover:text-brand-ink transition-colors"
                      title={`回到集合「${album.parentName}」`}
                    >
                      <FolderIcon size={11} className="shrink-0" />
                      {album.parentName}
                    </Link>
                  ) : (
                    <span className="album-bar__crumb inline-flex items-center gap-1 truncate">
                      <FolderIcon size={11} className="shrink-0" />
                      {album.parentName}
                    </span>
                  )}
                  <ChevronRightIcon
                    size={12}
                    className="shrink-0 text-fg-subtle"
                  />
                </>
              )}
              <h1 className="album-bar__title truncate">{title}</h1>
              <div className="album-bar__meta tabular-nums">
                {/* 计数口径与其它地方一致：纯视频相册说「2 个视频」，
                    不再写「0 张 · 2 个视频」。 */}
                <span>
                  <span className="text-fg font-medium">
                    {mediaCountParts(album).lead}
                  </span>
                  {mediaCountParts(album).rest && (
                    <>
                      {" "}
                      <span className="text-fg-subtle">·</span>{" "}
                      <span className="text-fg font-medium">
                        {mediaCountParts(album).rest}
                      </span>
                    </>
                  )}
                </span>
                {/* 媒体根：只有配置了多个根才值得说，否则每本都挂一句
                    同样的来源，是噪音。 */}
                {multiRoot && album.sourceName && (
                  <>
                    <span className="text-fg-subtle">·</span>
                    <span className="truncate">来自 {album.sourceName}</span>
                  </>
                )}
              </div>
            </div>

            {/* 右侧操作收成一组：多选、密度切换、收藏、更多。
                组内用 hairline 分隔，读起来是一个工具条而不是几个孤立按钮。

                收藏与「更多」在窄屏也留着：窄屏上右键菜单用不了，
                没有这一组，这一页就再也点不到「收藏」「复制链接」
                「设为封面」。密度切换只留宽屏 —— 窄屏的照片墙固定
                两列，给一个改不动的控件只是噪音。 */}
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 md:flex">
                <span className="text-meta text-fg-subtle">密度</span>
                <DensityControl value={density} onChange={setDensity} />
              </div>

              {/* 多选：批量加入精选、并排对比都从这里进。
                  它必须在窄屏也在 —— 触摸设备没有右键菜单，
                  批量挑选只能靠这个按钮。

                  放在密度控件之后：密度是「怎么看」，多选与收藏是
                  「对这一本做什么」，两组不是一件事。 */}
              <button
                type="button"
                onClick={() => {
                  // 同一个按钮进出多选：再按一次就退出，
                  // 不必另找一个「退出」的入口。
                  const state = usePhotoSelectionStore.getState();
                  if (state.active) state.clear();
                  else state.start();
                }}
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  selectionActive
                    ? "bg-brand/15 text-brand"
                    : "text-fg-muted hover:bg-bg-subtle hover:text-fg"
                }`}
                title={selectionActive ? "退出选择" : "选择照片"}
                aria-label={selectionActive ? "退出选择" : "选择照片"}
                aria-pressed={selectionActive}
              >
                <SelectIcon size={15} />
              </button>

              <button
                type="button"
                onClick={toggleFavorite}
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
                  isFavorite
                    ? "text-favorite hover:bg-favorite/10"
                    : "text-fg-muted hover:bg-bg-subtle hover:text-fg"
                }`}
                title={isFavorite ? "取消收藏" : "收藏"}
                aria-label={isFavorite ? "取消收藏" : "收藏"}
              >
                <StarIcon size={15} filled={isFavorite} />
              </button>

              <Popover
                align="end"
                aria-label="相册更多操作"
                trigger={
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
                    title="更多"
                    aria-label="更多操作"
                  >
                    <MoreHorizontalIcon size={15} />
                  </button>
                }
              >
                <PopoverLabel>相册</PopoverLabel>
                <PopoverItem
                  onClick={() => void openInExplorer()}
                  disabled={!actions.canOpenInExplorer}
                >
                  <FolderIcon size={13} />
                  <span>在文件管理器中打开</span>
                </PopoverItem>
                <PopoverItem onClick={() => void copyLink()}>
                  <CopyIcon size={13} />
                  <span>复制相册链接</span>
                </PopoverItem>
                {/* 「用当前查看的图片设为封面」原先在这里，但它是个死动作：
                  查看器是一层全屏浮层，打开时根本够不到这个菜单；
                  关掉查看器后 viewerIndex 已经清空，点了也不会有任何反应。
                  真正可用的两个入口是查看器里的「设为封面」按钮，
                  以及照片墙上右键单张照片时的「设为封面」。 */}
              </Popover>
            </div>
          </div>
          <nav
            aria-label="相册视图"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-faint py-2"
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSmartMode(false)}
                className={`rounded-md px-3 py-1.5 text-meta transition-colors ${
                  !smartMode
                    ? "bg-bg-elevated text-fg shadow-xs"
                    : "text-fg-muted hover:bg-bg-subtle hover:text-fg"
                }`}
                aria-pressed={!smartMode}
              >
                原始照片墙
              </button>
              <button
                type="button"
                onClick={() => setSmartMode(true)}
                className={`rounded-md px-3 py-1.5 text-meta transition-colors ${
                  smartMode
                    ? "bg-bg-elevated text-fg shadow-xs"
                    : "text-fg-muted hover:bg-bg-subtle hover:text-fg"
                }`}
                aria-pressed={smartMode}
              >
                智能相册
              </button>
              {showingSmartGroup && selectedGroup && (
                <span className="ml-2 truncate text-meta text-fg-muted">
                  {selectedGroup.name} · {selectedGroup.photoCount} 张
                </span>
              )}
            </div>
            {/* 筛选条只在原始照片墙这一边：智能相册的分组本身就是筛过的，
                再加一层筛选会让人以为那些分组还能再筛。 */}
            {!smartMode && (
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
            )}
          </nav>
          {/* 生效的条件逐条摆出来：条件能组合，用户不必回到面板里
              再点一次才能去掉其中一条。 */}
          {!smartMode && filterChips.length > 0 && (
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
        </div>
      </header>

      {smartMode && showingSmartGroup && !selectedGroup ? (
        <div className="page-shell min-h-0 flex-1 py-6">
          {smartGroupsQuery.isLoading ? (
            <div className="rounded-xl border border-border bg-bg-elevated p-6 text-body text-fg-muted">
              正在读取智能分组…
            </div>
          ) : smartGroupsQuery.isError ? (
            <ErrorBanner onRetry={() => void smartGroupsQuery.refetch()}>
              智能分组读取失败，请重试。
            </ErrorBanner>
          ) : (
            <EmptyState
              title="找不到这个智能分组"
              description="该分组可能已被重建、隐藏或移除。"
              action={
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setSelectedGroupId(null)}
                >
                  返回智能相册
                </button>
              }
            />
          )}
        </div>
      ) : smartMode && !showingSmartGroup ? (
        <SmartAlbumBrowser
          summary={smartSummary}
          loading={smartGroupsQuery.isLoading}
          error={smartGroupsQuery.isError}
          dimension={dimension}
          analyzing={analyzingJobIds.length > 0}
          peopleEnabled={peopleEnabled}
          rebuilding={rebuilding}
          onDimensionChange={setDimension}
          onAnalyze={() => void analyzeAlbum()}
          onAnalyzeDimension={(type) => void analyzeDimension(type)}
          onRebuild={() => void rebuildSmartGroups()}
          onSaveOverride={saveGroupOverride}
          onOpenGroup={setSelectedGroupId}
          modules={analysisJobsQuery.data?.snapshot.modules ?? []}
          jobs={analysisJobsQuery.data?.snapshot.jobs ?? []}
        />
      ) : (
        <div className="page-shell min-h-0 flex-1 pb-2">
          {showingSmartGroup && selectedGroup && (
            <div className="flex items-center gap-2 py-3 text-meta">
              <button
                type="button"
                onClick={() => setSelectedGroupId(null)}
                className="btn-text inline-flex items-center gap-1 text-brand hover:underline"
              >
                <ChevronLeftIcon size={13} /> 智能分组
              </button>
              <span className="text-fg-subtle">/</span>
              <span className="truncate text-fg">{selectedGroup.name}</span>
              <span className="shrink-0 text-fg-muted">
                {selectedGroup.photoCount} 张
              </span>
            </div>
          )}
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
            albumFilterCount(filter) > 0 ? (
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
              selecting={selectionActive}
              isSelected={isSelected}
              onToggleSelect={toggleSelect}
              isPicked={isPicked}
              onTogglePick={togglePick}
              itemOverlay={itemOverlay}
              scrollToIndex={wall.focusIndex}
              onContextMenu={menu.open}
            />
          )}
        </div>
      )}

      {selectionActive && (
        <PhotoSelectionBar
          selected={selectedEntries}
          pickedCount={selectedPickedCount}
          onAddPicks={addSelectedToPicks}
          onRemovePicks={removeSelectedFromPicks}
          onCompare={compareSelected}
          onExit={() => usePhotoSelectionStore.getState().clear()}
          busy={selectionBusy}
        />
      )}

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
              id: "pick",
              label: isPicked(menu.menu.item.id) ? "移出精选" : "加入精选",
              icon: isPicked(menu.menu.item.id) ? (
                <UncheckIcon size={12} />
              ) : (
                <CheckIcon size={12} />
              ),
            },
            {
              id: "copy",
              label: "复制相册链接",
              icon: <CopyIcon size={12} />,
            },
            {
              id: "cover",
              label: "设为封面",
              icon: <ImageIcon size={12} />,
            },
            /* 换代表照片：只有属于某个相似组的照片才有这个动作。
               它是用户自己的决定，写进相似照片的人工决定里。 */
            ...(menu.menu.item.similarityGroup
              ? ([
                  {
                    id: "representative",
                    label: "设为相似组代表",
                    icon: <PickIcon size={12} />,
                  },
                ] as AnyMenuItem[])
              : []),
            { id: "sep1", separator: true } as AnyMenuItem,
            {
              id: "properties",
              label: "属性",
              icon: <InfoIcon size={12} />,
            },
            {
              id: "explorer",
              label: "在文件管理器中打开",
              icon: <ArrowUpRightIcon size={12} />,
              disabled: !actions.canOpenInExplorer,
            },
          ]}
          onSelect={(id) => {
            const item = menu.menu!.item;
            menu.close();
            if (id === "open") {
              const index = mediaItems.findIndex((it) => it.id === item.id);
              if (index >= 0) wall.open(index);
              return;
            }
            if (id === "pick") {
              togglePick(item);
              return;
            }
            if (id === "cover") {
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
            if (id === "properties") setPropertiesFileId(item.id);
            if (id === "copy") void copyLink();
            if (id === "explorer") void openInExplorer();
            if (id === "representative" && item.similarityGroup) {
              void setRepresentative(item.similarityGroup.id, item.id);
            }
          }}
          onClose={menu.close}
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
