import { useSetCollectionCover } from "../../hooks/useComicMeta";
import { useImageProgressSync } from "../../hooks/useImageProgressSync";
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useGalleryStore } from "../../store/galleryStore";
import { albumsApi } from "../../api/albums";
import { historyApi } from "../../api/prefs";
import { syncHistoryCache } from "../../utils/historyCache";
import { activityApi, isActivityNotFound } from "../../api/activity";
import { useUIStore } from "../../store/uiStore";
import { useFavorites } from "../../hooks/useFavorites";
import { libraryQueryKeys } from "../../api/queryKeys";
import { useLibraryNodes } from "../../hooks/useLibrary";
import { fsApi } from "../../api/fs";
import { useFsCapabilities } from "../../hooks/useFsCapabilities";
import { fileManagerErrorMessage } from "../../utils/fileManager";
import { apiErrorMessage } from "../../utils/apiError";
import { displayedPageIndex } from "../../utils/progress";
import {
  albumRoute,
  homeRoute,
  libraryRoute,
  readerRoute,
} from "../../utils/path";
import { useSafeBack } from "../../utils/navigation";
import { usePrefs } from "../../hooks/usePrefs";
import { useVideoActivity } from "../../hooks/useVideoActivity";
import { useAppMode } from "../../hooks/useAppMode";
import { toggleFullscreen } from "../../utils/fullscreen";
import {
  useAdjacentAlbum,
  useSiblingVolumes,
} from "../../hooks/useAdjacentAlbum";
import { useReaderMedia } from "../../hooks/useReaderMedia";
import { useReaderKeys } from "../../hooks/useReaderKeys";
import type { AppMode } from "../../api/library";

import { useReaderChrome } from "./useReaderChrome";
import {
  clampPage,
  spreadAt,
  nextSpreadIndex,
  prevSpreadIndex,
} from "./readerLayout";
import type {
  JumpSource,
  ReaderJump,
  ReaderObservation,
  ReaderCommandTarget,
  ReaderViewportHandle,
} from "./useReaderViewport";

export function useReaderController() {
  const [params] = useSearchParams();
  const routeParams = useParams();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  const queryClient = useQueryClient();

  // 漫画阅读器的路由是 /comic/read/<album id>。
  const pathParam = decodeURIComponent(routeParams["albumId"] ?? "");
  const hasExplicitIndex = params.has("index");
  const parsedIndex = Number(params.get("index"));
  const initialIndex = Number.isFinite(parsedIndex)
    ? Math.max(0, Math.floor(parsedIndex))
    : 0;
  // type=video 走 VideoPlayer；其它（含未传）走 ImageGallery。
  // 视频播放进度将在独立模型中持久化，不能复用相册的页码进度。
  const typeParam = (params.get("type") ?? "image") as "image" | "video";
  const isVideo = typeParam === "video";
  const isVideoRef = useRef(isVideo);
  isVideoRef.current = isVideo;

  const media = useReaderMedia(pathParam, isVideo);
  const { images, videos, dimensions, reload: reloadMedia } = media;
  const ready = media.status === "ready";

  const viewportRef = useRef<ReaderViewportHandle>(null);
  const sequence = useRef(0),
    lastJump = useRef(0);
  const [request, setRequest] = useState<ReaderJump>({
    index: 0,
    epoch: 0,
    source: "restore",
  });
  const [observation, setObservation] = useState<ReaderObservation | null>(
    null,
  );
  const [imageActivityReadyPath, setImageActivityReadyPath] = useState("");

  const index = useGalleryStore((s) => s.index);
  const setIndex = useGalleryStore((s) => s.setIndex);
  const slideshow = useGalleryStore((s) => s.slideshow);
  const slideshowInterval = useGalleryStore((s) => s.slideshowInterval);
  const toggleSlideshow = useGalleryStore((s) => s.toggleSlideshow);
  const mode = useGalleryStore((s) => s.mode);

  const coverOffset = useGalleryStore((s) => s.coverOffset);
  const autoHide = useGalleryStore((s) => s.immersiveAutoHide);
  const [drawerTab, setDrawerTab] = useState<"pages" | "chapters">("pages");
  const [showInfo, setShowInfo] = useState(false);
  const { mode: workbenchMode, setMode: setWorkbenchMode } = useAppMode();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoTarget, setInfoTarget] = useState<ReaderCommandTarget | null>(
    null,
  );
  const toggleInfo = useCallback(() => {
    setInfoTarget(null);
    setShowInfo((v) => !v);
  }, []);
  const [showHelp, setShowHelp] = useState(false);
  // 目录：整本缩略图，按需打开，不打断连续阅读。
  const [showOverview, setShowOverview] = useState(false);
  // 读完一卷后的收尾提示（自动切下一卷关闭时才出现）。
  const [showFinished, setShowFinished] = useState(false);
  // 右键菜单位置(阅读器内任意位置右键都触发)。
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: ReaderCommandTarget;
  } | null>(null);
  // 「阅读到末尾自动切换下一卷」「切换时显示通知」两个阅读偏好。
  // 未加载前按服务端默认值处理（都是开启）。
  const chrome = useReaderChrome({
    autoHide: autoHide && !isVideo,
    lockedOpen:
      isVideo ||
      showOverview ||
      showHelp ||
      settingsOpen ||
      menuOpen ||
      showInfo ||
      Boolean(contextMenu),
  });
  const toggleDrawer = (tab: "pages" | "chapters") => {
    setShowOverview(!showOverview || tab !== drawerTab);
    setDrawerTab(tab);
  };
  const { data: prefs } = usePrefs();
  const autoSwitchAlbum = prefs?.autoSwitchAlbum ?? true;
  const showSwitchNotif = prefs?.showSwitchNotif ?? true;

  const [reloadKey, setReloadKey] = useState(0);
  const [progressFailure, setProgressFailure] = useState<{
    key: string;
    operation: "restore" | "save";
  } | null>(null);
  const [retryingProgress, setRetryingProgress] = useState(false);
  const finishedRef = useRef(false);
  // 「刚读完」与「恢复到上次位置」的区分：恢复到末页的那一次是打开一卷
  // 早就读完的书，不该弹收尾提示。
  const restoringRef = useRef(false);
  // 持有「最新」index/total；sendBeacon 关闭时从这里取最新值。
  // 同时记录 path，只有 images 有效时才更新 — 避免切到新 album 的 loading
  // 阶段把 path 也更新成新的，导致 sendBeacon 发往错的 album。
  const progressRef = useRef<{ path: string; index: number; total: number }>({
    path: "",
    index: 0,
    total: 0,
  });
  // 记录「上一个」pathParam；切 album 时用它来保存上一个的进度，
  // 而不是用 effect 闭包里的新 pathParam（会写错位置）。
  const lastPathRef = useRef<string>("");

  const fullscreen = useCallback(async () => {
    if (!(await toggleFullscreen()))
      pushToast({ kind: "error", message: "当前无法进入或退出全屏" });
  }, [pushToast]);
  const { favorites, toggle: toggleFavorite } = useFavorites();
  const isFav = pathParam ? favorites.includes(pathParam) : false;
  // 服务端是否允许打开系统文件管理器（配置项 allowOsOpen）。
  const allowOsOpen = useFsCapabilities();

  // 当前相册是否已有自定义封面。摘要索引和媒体清单都来自同一份目录快照，
  // 因此阅读器无需为这个小状态额外请求含完整媒体数组的相册详情。
  const [hasCustomCover, setHasCustomCover] = useState(false);
  const albumSummaryQuery = useLibraryNodes(pathParam ? [pathParam] : []);
  const albumSummary = albumSummaryQuery.data?.items.find(
    (item) => item.id === pathParam,
  );
  const parentSummary = useLibraryNodes(
    albumSummary?.parentId ? [albumSummary.parentId] : [],
  ).data?.items[0];
  const name =
    [albumSummary?.comic?.chapterLabel, albumSummary?.comic?.cleanTitle]
      .filter((v, i, a) => v && a.indexOf(v) === i)
      .join(" · ") ||
    albumSummary?.displayName ||
    albumSummary?.name ||
    params.get("name") ||
    "画廊";
  // 顶栏里的名字：漫画的卷名只写「第1卷」，这一卷属于哪部作品
  // 看不出来。作品名补在前面，与书封上的写法一致 —— 翻开一本时
  // 顶栏该说的是「星海漫步 · 第1卷」。
  const parentName =
    parentSummary?.comic?.cleanTitle || albumSummary?.parentName;
  const headerName =
    parentName && parentName !== name ? `${parentName} · ${name}` : name;

  // 返回：优先回到应用内的上一页；没有可回退历史时回到能确认的来路。
  // 直接打开阅读器链接（刷新、复制链接到新标签页）时，navigate(-1) 会
  // 一路退出应用停在空白页，必须有兜底。
  //
  // 兜底落在相册自己所属的那一侧：阅读器主要是漫画用的，但照片相册
  // 也能被视频播放页复用，返回时不该跳到另一侧去。
  //
  // 照片侧回到这一本自己的相册页（照片墙）：阅读器放的就是这本的内容，
  // 它的来路就是那面墙。回到上级集合会跳过这一本。
  //
  // 漫画侧不能回这一卷的相册地址 —— 漫画卷的相册地址会重定向回阅读器，
  // 深链打开阅读器时按返回会原地打转。那里回落到所属作品，上级不明
  // 就回书架：它按作品与卷把内容摊开，比回到工作台首页更贴上下文。
  const albumSide = albumSummary?.contentKind ?? "comic";
  const goBack = useSafeBack(() => {
    if (albumSide !== "comic") {
      return pathParam
        ? albumRoute(albumSide, pathParam)
        : libraryRoute(albumSide);
    }
    const parentId = albumSummary?.parentId;
    if (parentId) return albumRoute("comic", parentId);
    return libraryRoute("comic");
  });
  // 当前展示的文件路径。Gallery 中段才计算 isVideo/images/videos/index → current，
  // 但 onSetCover 要读这个值。放进 ref 让 callback 拿到最新值而不需要把 current
  // 提前到 useCallback 之前（避免引入 forward reference）。
  const currentRef = useRef<string | null>(null);

  useEffect(() => {
    setHasCustomCover(Boolean(albumSummary?.hasCustomCover));
  }, [albumSummary?.hasCustomCover, pathParam]);

  // 切到新相册：把上一卷的进度刷一次，并清掉上一卷留下的读取状态。
  //
  // 刷进度用 lastPathRef（上一个 pathParam），不是闭包里的新 pathParam。
  useEffect(() => {
    if (!pathParam) return;
    if (lastPathRef.current) {
      const previous = progressRef.current;
      if (previous.path === lastPathRef.current && previous.total > 0) {
        activityApi
          .setImage(previous.path, previous.index, previous.total)
          .catch(() => {});
      }
    }
    lastPathRef.current = pathParam;
    setImageActivityReadyPath("");
    setObservation(null);
    setShowFinished(false);
    setContextMenu(null);
    setInfoTarget(null);
    progressRef.current = { path: "", index: 0, total: 0 };
    finishedRef.current = false;
    restoringRef.current = false;
  }, [pathParam]);

  const videoItemIndex = isVideo
    ? Math.max(0, Math.min(initialIndex, Math.max(0, videos.length - 1)))
    : 0;
  const currentVideo = isVideo ? videos[videoItemIndex] : undefined;
  const videoActivityKey =
    isVideo && pathParam && currentVideo
      ? JSON.stringify([pathParam, currentVideo])
      : "";
  const progressKey = JSON.stringify([pathParam, isVideo, currentVideo ?? ""]);
  const activeProgressKey = useRef(progressKey);
  activeProgressKey.current = progressKey;
  const reportProgressFailure = useCallback(
    (operation: "restore" | "save") => {
      if (activeProgressKey.current === progressKey) {
        setProgressFailure({ key: progressKey, operation });
      }
    },
    [progressKey],
  );
  const clearProgressFailure = useCallback(
    (operation: "restore" | "save") => {
      setProgressFailure((failure) =>
        failure?.key === progressKey && failure.operation === operation
          ? null
          : failure,
      );
    },
    [progressKey],
  );
  const observedLast =
    observation?.albumId === pathParam && observation.epoch === sequence.current
      ? displayedPageIndex(observation.last, images.length)
      : null;
  const imageActivityPageIndex = observedLast ?? 0;
  const imageActivityWritable =
    !isVideo &&
    ready &&
    imageActivityReadyPath === pathParam &&
    observedLast !== null;
  const jumpImage = useCallback(
    (raw: number, source: JumpSource = "key") => {
      if (!images.length) return;
      const target = clampPage(raw, images.length);
      if (source !== "restore") restoringRef.current = false;
      setObservation(null);
      setShowFinished(false);
      setIndex(target);
      lastJump.current = ++sequence.current;
      setRequest({ index: target, source, epoch: lastJump.current });
    },
    [images.length, setIndex],
  );
  const onInvalidate = useCallback(
    (requestEpoch: number, relayout: boolean, reindexedTarget?: number) => {
      if (requestEpoch !== lastJump.current) return requestEpoch;
      if (reindexedTarget !== undefined) setIndex(reindexedTarget);
      setObservation(null);
      return relayout ? ++sequence.current : sequence.current;
    },
    [setIndex],
  );
  const onObserve = useCallback(
    (o: ReaderObservation) => {
      if (o.albumId !== pathParam || o.epoch !== sequence.current) return;
      setObservation((prev) =>
        prev?.first === o.first &&
        prev.last === o.last &&
        prev.epoch === o.epoch &&
        prev.atTop === o.atTop &&
        prev.atBottom === o.atBottom
          ? prev
          : o,
      );
      const current = useGalleryStore.getState().index;
      if (current < o.first || current > o.last) setIndex(o.first);
    },
    [pathParam, setIndex],
  );

  useEffect(() => {
    if (!imageActivityWritable) return;
    progressRef.current = {
      path: pathParam,
      index: imageActivityPageIndex,
      total: images.length,
    };
  }, [imageActivityPageIndex, imageActivityWritable, images.length, pathParam]);

  useEffect(() => {
    if (!isVideo) useGalleryStore.getState().resetView();
  }, [pathParam, isVideo]);

  // 恢复阅读进度：媒体就绪后按 URL 里的 index 或服务端记录定位。
  //
  // reloadKey 参与依赖：重试时要再恢复一次（失败提示里的「重试进度」
  // 走的就是这条路）。
  useEffect(() => {
    if (!ready) return;
    const list = isVideo ? videos : images;
    if (!isVideo) {
      jumpImage(initialIndex, params.has("index") ? "link" : "restore");
    }
    if (!pathParam) return;
    // URL 显式带 index= 时表示「用户点了某张图/某条链接」,跳过 progress 恢复
    // — 否则会从后端图片活动拉出上次位置把 initialIndex 顶掉,
    // 导致「点任意图都跳到上次看到的那张」(Album 详情缩略图 / AlbumCard
    // hover preview 跳进来都会撞这个)。
    if (hasExplicitIndex) {
      if (!isVideo) setImageActivityReadyPath(pathParam);
      return;
    }
    if (isVideo) return;
    setImageActivityReadyPath("");
    let cancelled = false;
    // 这次定位是「恢复」而不是「刚读完」：末页恢复不该弹收尾提示。
    restoringRef.current = true;
    const restoreEpoch = lastJump.current;
    activityApi
      .getImage(pathParam)
      .then((rp) => {
        if (cancelled) return;
        // 保存的是已展示的末页，画布依据它计算跨页。
        const pageIndex = Math.max(0, Math.min(list.length - 1, rp.pageIndex));
        if (lastJump.current === restoreEpoch) {
          restoringRef.current = rp.pageIndex >= list.length - 1;
          jumpImage(pageIndex, "restore");
        } else restoringRef.current = false;
        setImageActivityReadyPath(pathParam);
        clearProgressFailure("restore");
      })
      .catch((error) => {
        if (!cancelled && isActivityNotFound(error)) {
          restoringRef.current = false;
          setImageActivityReadyPath(pathParam);
          clearProgressFailure("restore");
        } else if (!cancelled) {
          reportProgressFailure("restore");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pathParam, isVideo, reloadKey, hasExplicitIndex, initialIndex]);

  // 标题和图片总数来自相册摘要，不用 URL 提示或当前视频列表改写访问记录。
  const historyReady = ready && albumSummary?.kind === "album";
  const historyName = albumSummary?.displayName || albumSummary?.name || "";
  const historyImageCount = albumSummary?.imageCount ?? 0;
  useEffect(() => {
    if (!pathParam || !historyReady) return;
    historyApi
      .add({
        albumId: pathParam,
        name: historyName,
        imageCount: historyImageCount,
      })
      .then(({ history }) => syncHistoryCache(queryClient, history))
      .catch(() => {});
  }, [pathParam, historyName, historyImageCount, queryClient, historyReady]);

  const onImageSaved = useCallback(
    () => clearProgressFailure("save"),
    [clearProgressFailure],
  );
  const onImageSaveFailed = useCallback(
    () => reportProgressFailure("save"),
    [reportProgressFailure],
  );
  // 可见区末页可能随画布宽度改变；进度同步不负责关闭信息面板。
  const imageProgress = useImageProgressSync({
    albumId: pathParam,
    pageIndex: imageActivityPageIndex,
    pageCount: images.length,
    enabled: imageActivityWritable,
    onSaved: onImageSaved,
    onSaveFailed: onImageSaveFailed,
  });

  // 切换到另一张图片/另一个视频时关闭信息面板。
  //
  // 判据是「当前媒体的资源 ID」而不是页码：连续模式下画布宽度变化会让
  // 可见区末页跟着变，用页码当判据会导致面板一打开就被自己关掉。
  // 这里不能直接引用下面才声明的 `current`（const 有暂时性死区），
  // 所以按同样的规则在这里另算一份。
  const currentMediaId = (isVideo ? currentVideo : images[index]) ?? null;
  useEffect(() => {
    setShowInfo(false);
    setInfoTarget(null);
  }, [currentMediaId]);

  // 视频的播放位置（毫秒）由 useVideoActivity 单独管：恢复 → 节流写入 →
  // 补写，和图片的页码进度是两套模型。
  const videoActivity = useVideoActivity({
    isVideo,
    albumId: pathParam,
    itemId: currentVideo,
    ready,
    activityKey: videoActivityKey,
    onRestored: () => clearProgressFailure("restore"),
    onRestoreFailed: () => reportProgressFailure("restore"),
    onSaved: () => clearProgressFailure("save"),
    onSaveFailed: () => reportProgressFailure("save"),
  });

  // 重新拉这一卷：媒体清单与阅读进度都重来一遍。
  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
    reloadMedia();
  }, [reloadMedia]);

  async function retryProgress() {
    if (retryingProgress) return;
    if (progressFailure?.operation === "restore") {
      reload();
      return;
    }
    setRetryingProgress(true);
    try {
      if (isVideo) {
        // 视频位置由 hook 自己落盘：成功时它会清掉提示，失败时上报。
        await videoActivity.retrySave();
        return;
      }
      const progress = progressRef.current;
      if (!imageActivityWritable || progress.path !== pathParam) return;
      await imageProgress.save(progress.path, progress.index, progress.total);
    } catch {
      reportProgressFailure("save");
    } finally {
      setRetryingProgress(false);
    }
  }

  useEffect(() => {
    if (!imageActivityWritable) return;
    if (imageActivityPageIndex !== images.length - 1) {
      finishedRef.current = false;
      restoringRef.current = false;
      setShowFinished(false);
      return;
    }
    if (!finishedRef.current && !restoringRef.current) setShowFinished(true);
    finishedRef.current = true;
    restoringRef.current = false;
  }, [imageActivityPageIndex, imageActivityWritable, images.length]);

  useEffect(() => {
    const flushCurrentActivity = () => {
      // 视频位置由 useVideoActivity 自己补写（它有独立的会话状态机）。
      if (isVideoRef.current) return;
      // pagehide 覆盖刷新/关闭页签；cleanup 覆盖 SPA 卸载。
      // 只发送已完成恢复、且属于当前相册的最后有效图片活动。
      const cur = progressRef.current;
      if (cur.path && cur.total > 0) {
        activityApi.keepalive({
          albumId: cur.path,
          mediaKind: "image",
          pageIndex: cur.index,
          pageCount: cur.total,
        });
        progressRef.current = { path: "", index: 0, total: 0 };
      }
    };
    window.addEventListener("pagehide", flushCurrentActivity);
    return () => {
      window.removeEventListener("pagehide", flushCurrentActivity);
      flushCurrentActivity();
    };
  }, []);

  useEffect(() => {
    const off = () => setShowHelp(true);
    window.addEventListener("gallery:open-help", off as EventListener);
    return () =>
      window.removeEventListener("gallery:open-help", off as EventListener);
  }, []);

  // 视频项由 URL 的 index 参数定位（以 initialIndex 为真相源），
  // 切视频必须改 URL 的 index 参数，
  // 用 replace:true 避免一路 next 把 history 撑爆。
  const goToVideo = useCallback(
    (targetIdx: number) => {
      if (!isVideo) return;
      const i = Math.max(0, Math.min(videos.length - 1, targetIdx));
      const next = new URLSearchParams(params);
      next.set("index", String(i));
      navigate(`${readerRoute(pathParam)}?${next.toString()}`, {
        replace: true,
      });
    },
    [isVideo, videos.length, params, navigate, pathParam],
  );

  // 跳卷：上一卷 / 下一卷。
  //
  // 兄弟卷兜底：上下文记的是「用户从哪个列表点进来的」。从首页
  // 「继续阅读」进来说卷时，那份上下文里未必有这一卷 —— 没有兜底，
  // 「下一卷」就没有落脚点。同一作品里的卷一次取全，跨卷导航在作品
  // 内部至少接得上。
  const siblingEntries = useSiblingVolumes(albumSummary?.parentId, pathParam);
  const closeInfo = useCallback(() => setShowInfo(false), []);
  const { goAdjacent, adjacentNames } = useAdjacentAlbum({
    pathParam,
    isVideo,
    onBeforeNavigate: closeInfo,
    fallbackEntries: siblingEntries,
  });
  // 有没有下一卷：跨卷导航算出来的目标卷名就是答案（没有下一卷时
  // 它是空串）。收尾提示据此换一句话、也据此决定要不要留那个按钮。
  const hasNextVolume = Boolean(adjacentNames.next || adjacentNames.more);

  // 已到末尾的统一反馈：toast + 自动停幻灯片。
  // 用 ref 持有,避免 setInterval 闭包捕获旧的 onReachEnd 引用
  // (slideshow effect 的 deps 不包含 pushToast/toggleSlideshow,这些会
  // 因 user 操作 stale,但回调需要读最新 store + push 最新 toast)。
  const advancing = useRef(false);
  const onReachEndRef = useRef<() => void>(() => {});
  onReachEndRef.current = async () => {
    // 「阅读到末尾自动切换下一卷」：读完直接进入上下文里的下一卷，
    // 幻灯片也跟着继续（不当作异常终止）。
    if (
      !isVideo &&
      (observation?.epoch !== sequence.current ||
        observation.albumId !== pathParam ||
        observation.last !== images.length - 1)
    )
      return;
    if (autoSwitchAlbum && (isVideo || hasNextVolume)) {
      if (advancing.current) return;
      advancing.current = true;
      const epoch = sequence.current;
      try {
        const moved = await goAdjacent(1, {
          notify: showSwitchNotif,
          albumsOnly: true,
        });
        if (
          moved ||
          activeProgressKey.current !== progressKey ||
          epoch !== sequence.current
        )
          return;
      } finally {
        advancing.current = false;
      }
    }
    if (isVideo) {
      pushToast({
        kind: "info",
        message:
          media.siblingCount > 0
            ? `已是最后一个视频 · 相册里另有 ${media.siblingCount} 页图片`
            : "已是最后一个视频",
        ttl: 1500,
      });
    } else setShowFinished(true);
    if (useGalleryStore.getState().slideshow) {
      toggleSlideshow();
      pushToast({ kind: "info", message: "幻灯片已自动停止" });
    }
  };
  const onReachEnd = useCallback(() => onReachEndRef.current(), []);

  const prev = useCallback(() => {
    if (isVideo) {
      const cur = Math.max(
        0,
        Math.min(initialIndex, Math.max(0, videos.length - 1)),
      );
      if (cur > 0) goToVideo(cur - 1);
      return;
    }
    if (mode === "continuous") {
      viewportRef.current?.scrollScreen(-1);
      return;
    }
    if (mode === "double") {
      if (index > 0)
        jumpImage(prevSpreadIndex(index, images.length, coverOffset));
    } else if (index > 0) {
      jumpImage(index - 1);
    }
  }, [
    isVideo,
    initialIndex,
    videos.length,
    goToVideo,
    mode,
    coverOffset,
    jumpImage,
    index,
    images.length,
  ]);

  const next = useCallback(() => {
    if (isVideo) {
      const cur = Math.max(
        0,
        Math.min(initialIndex, Math.max(0, videos.length - 1)),
      );
      if (cur < videos.length - 1) {
        goToVideo(cur + 1);
        return;
      }
      onReachEnd();
      return;
    }
    if (mode === "continuous") {
      if (!viewportRef.current?.scrollScreen(1) && observation?.atBottom)
        void onReachEnd();
      return;
    }
    if (mode === "double") {
      const last = spreadAt(index, images.length, coverOffset).at(-1) ?? 0;
      if (last + 1 < images.length) {
        jumpImage(nextSpreadIndex(index, images.length, coverOffset));
        return;
      }
      onReachEnd();
      return;
    }
    if (index < images.length - 1) {
      jumpImage(index + 1);
      return;
    }
    onReachEnd();
  }, [
    isVideo,
    initialIndex,
    videos.length,
    goToVideo,
    mode,
    coverOffset,
    jumpImage,
    index,
    observation?.atBottom,
    images.length,
    onReachEnd,
  ]);

  const jumpTo = useCallback(
    (i: number, source: JumpSource = "slider") => {
      if (isVideo) goToVideo(i);
      else jumpImage(i, source);
    },
    [isVideo, goToVideo, jumpImage],
  );

  const advanceRef = useRef(next);
  advanceRef.current = next;
  useEffect(() => {
    if (
      isVideo ||
      !ready ||
      !slideshow ||
      showHelp ||
      showOverview ||
      settingsOpen ||
      menuOpen ||
      contextMenu
    )
      return;
    const timer = setInterval(() => advanceRef.current(), slideshowInterval);
    return () => clearInterval(timer);
  }, [
    isVideo,
    ready,
    slideshow,
    slideshowInterval,
    showHelp,
    showOverview,
    settingsOpen,
    menuOpen,
    contextMenu,
  ]);

  const onToggleFavorite = useCallback(() => {
    if (!pathParam) return;
    toggleFavorite(pathParam)
      .then(() => {
        const was = favorites.includes(pathParam);
        pushToast({
          kind: "success",
          message: was ? "已取消收藏" : "已加入收藏",
          ttl: 1200,
        });
      })
      .catch(() => pushToast({ kind: "error", message: "收藏失败" }));
  }, [pathParam, favorites, toggleFavorite, pushToast]);

  // 在系统文件管理器里定位当前这一份媒体文件。
  // 服务端对文件资源走 explorer /select 的方式打开所在目录并高亮该文件，
  // 这正是"我正在看的就是磁盘上这一份"的诉求。
  const onOpenInExplorer = useCallback(
    (target?: ReaderCommandTarget) => {
      if (!allowOsOpen || (target && target.albumId !== pathParam)) return;
      const id = target?.fileId ?? currentRef.current;
      if (!id) return;
      void fsApi
        .openInExplorer(id)
        .then(() =>
          pushToast({
            kind: "success",
            message: "已请求打开文件",
            ttl: 1200,
          }),
        )
        .catch((error: unknown) =>
          pushToast({
            kind: "error",
            message: fileManagerErrorMessage(error),
          }),
        );
    },
    [pushToast, pathParam, allowOsOpen],
  );

  // 把当前展示的图片/视频设为本相册的封面。成功后统一失效摘要查询，
  // 卡片、搜索和阅读器的封面状态会从同一个新 revision 重新读取。
  //
  // 注：current 是在组件后段计算的（依赖 isVideo / images / videos / index），
  // 因此这里在 callback 内通过 useGalleryStore.getState() 读 index、images、videos
  // 实时算 current，避免依赖数组出现 forward reference；每次按键都拿到当前真实文件。
  const workCover = useSetCollectionCover(albumSummary?.parentId ?? "");
  const onSetWorkCover = albumSummary?.parentId
    ? (target: ReaderCommandTarget) => {
        if (target.albumId === pathParam)
          workCover.mutate(target.fileId, {
            onSuccess: () =>
              pushToast({ kind: "success", message: "已设为作品总封面" }),
            onError: () =>
              pushToast({ kind: "error", message: "设置总封面失败" }),
          });
      }
    : undefined;
  const onSetCover = useCallback(
    async (target?: ReaderCommandTarget) => {
      if (!pathParam) return;
      if (target && target.albumId !== pathParam) return;
      const cur = target?.fileId ?? currentRef.current;
      if (!cur) return;
      await albumsApi
        .setCover(pathParam, cur)
        .then(() => {
          setHasCustomCover(true);
          void queryClient.invalidateQueries({
            queryKey: libraryQueryKeys.root,
          });
          pushToast({ kind: "success", message: "已设为封面", ttl: 1200 });
        })
        .catch((e) => {
          pushToast({
            kind: "error",
            message: apiErrorMessage(e, "设置封面失败"),
          });
        });
    },
    [pathParam, queryClient, pushToast],
  );

  // 清除自定义封面：回退到扫描器默认（images[0] / videos[0]）。
  const onClearCover = useCallback(() => {
    if (!pathParam) return;
    albumsApi
      .clearCover(pathParam)
      .then(() => {
        setHasCustomCover(false);
        void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.root });
        pushToast({ kind: "success", message: "已恢复默认封面", ttl: 1200 });
      })
      .catch((e) => {
        pushToast({
          kind: "error",
          message: apiErrorMessage(e, "清除封面失败"),
        });
      });
  }, [pathParam, queryClient, pushToast]);

  // 切换工作台：阅读器整屏脱离 AppShell，侧栏不可见，
  // 这里离开阅读器回到外壳，顺带把工作台换掉。
  const openWorkbench = useCallback(
    (next: AppMode) => {
      setWorkbenchMode(next);
      navigate(homeRoute(next));
    },
    [navigate, setWorkbenchMode],
  );

  useReaderKeys(
    {
      isVideo,
      fullscreen,
      prev: () => {
        chrome.show();
        prev();
      },
      next: () => {
        chrome.show();
        next();
      },
      jumpToFirst: () => jumpTo(0, "key"),
      jumpToLast: () => jumpTo((isVideo ? videos : images).length - 1, "key"),
      toggleInfo,
      toggleOverview: () => toggleDrawer("pages"),
      toggleChapters: () => toggleDrawer("chapters"),
      toggleChrome: chrome.toggle,
      advance: () => {
        if (mode === "continuous" && observation?.atBottom && hasNextVolume)
          void goAdjacent(1, { albumsOnly: true });
        else next();
      },
      toggleOffset: () => {
        if (mode === "double") {
          useGalleryStore.getState().setCoverOffset(!coverOffset);
          pushToast({
            kind: "info",
            message: coverOffset
              ? "已关闭封面单页偏移"
              : "已开启封面单页偏移（1 | 2-3）",
          });
        }
      },
      toggleHelp: () => setShowHelp((v) => !v),
      toggleFinished: () => setShowFinished((v) => !v),
      toggleFavorite: onToggleFavorite,
      setCover: () => void onSetCover(),
      clearCover: onClearCover,
      nextAlbum: () => {
        void goAdjacent(1, { notify: showSwitchNotif, albumsOnly: true });
      },
      prevAlbum: () => {
        void goAdjacent(-1, { notify: showSwitchNotif, albumsOnly: true });
      },
      onEscape: goBack,
    },
    {
      showHelp,
      showOverview,
      showInfo,
      showFinished,
      ready,
    },
  );

  // 显示给用户看的 item index（1 / 2 那种）。
  // 视频模式下 current / itemIndex 基于 URL 的 initialIndex，和图片阅读页码
  // 状态保持隔离。
  const current = (isVideo ? currentVideo : images[index]) ?? null;
  // 把 current 同步进 ref,让 onSetCover (声明在前) 拿到最新值。
  if (ready) currentRef.current = current;
  const total = isVideo ? videos.length : images.length;
  const itemIndex = videoItemIndex;

  return {
    chrome,
    coverOffset,
    drawerTab,
    setDrawerTab,
    toggleDrawer,
    albumSummary,
    adjacentNames,
    autoSwitchAlbum,
    observation,
    albumSide,
    allowOsOpen,
    fullscreen,
    toggleInfo,
    contextMenu,
    current,
    dimensions,
    goAdjacent,
    goBack,
    goToVideo,
    hasCustomCover,
    hasNextVolume,
    headerName,
    images,
    index,
    initialIndex,
    isFav,
    isVideo,
    itemIndex,
    jumpTo,
    media,
    mode,
    next,
    onClearCover,
    onObserve,
    onInvalidate,
    request,
    viewportRef,
    infoTarget,
    setInfoTarget,
    settingsOpen,
    setSettingsOpen,
    setMenuOpen,
    onOpenInExplorer,
    onSetWorkCover,
    onSetCover,
    onToggleFavorite,
    openWorkbench,
    pathParam,
    prev,
    progressFailure,
    progressKey,
    pushToast,
    ready,
    reload,
    retryProgress,
    retryingProgress,
    setContextMenu,
    setIndex,
    setShowFinished,
    setShowHelp,
    setShowInfo,
    setShowOverview,
    showFinished,
    showHelp,
    showInfo,
    showOverview,
    showSwitchNotif,
    total,
    videoActivity,
    videoActivityKey,
    videos,
    workbenchMode,
  };
}
export type ReaderController = ReturnType<typeof useReaderController>;
