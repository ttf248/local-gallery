import { useImageProgressSync } from "../hooks/useImageProgressSync";
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useGalleryStore } from "../store/galleryStore";
import { albumsApi } from "../api/albums";
import { historyApi } from "../api/prefs";
import { syncHistoryCache } from "../utils/historyCache";
import { activityApi, isActivityNotFound } from "../api/activity";
import { useUIStore } from "../store/uiStore";
import { useFavorites } from "../hooks/useFavorites";
import { libraryQueryKeys } from "../api/queryKeys";
import { useLibraryNodes } from "../hooks/useLibrary";
import { fsApi } from "../api/fs";
import { useFsCapabilities } from "../hooks/useFsCapabilities";
import { fileManagerErrorMessage } from "../utils/fileManager";
import { apiErrorMessage } from "../utils/apiError";
import ImageGallery from "../components/gallery/ImageGallery";
import VideoPlayer from "../components/gallery/VideoPlayer";
import PageSlider from "../components/gallery/PageSlider";
import ImageInfoPanel from "../components/common/ImageInfoPanel";
import HelpOverlay from "../components/common/HelpOverlay";
import GalleryHeader from "../components/gallery/GalleryHeader";
import GalleryToolbar from "../components/gallery/GalleryToolbar";
import GalleryAlbumNav from "../components/gallery/GalleryAlbumNav";
import PageOverview from "../components/gallery/PageOverview";
import ContextMenu, { type AnyMenuItem } from "../components/album/ContextMenu";
import {
  CloseIcon,
  ImageIcon,
  RefreshIcon,
  ArrowUpRightIcon,
} from "../components/common/Icon";
import { displayedPageIndex } from "../utils/progress";
import { albumRoute, homeRoute, libraryRoute, readerRoute } from "../utils/path";
import { useSafeBack } from "../utils/navigation";
import { usePrefs } from "../hooks/usePrefs";
import { useVideoActivity } from "../hooks/useVideoActivity";
import { useAppMode } from "../hooks/useAppMode";
import { useIdleChrome } from "../hooks/useIdleChrome";
import { useAdjacentAlbum, useSiblingVolumes } from "../hooks/useAdjacentAlbum";
import { useReaderMedia } from "../hooks/useReaderMedia";
import { useReaderKeys } from "../hooks/useReaderKeys";
import type { AppMode } from "../api/library";
import "../styles/reader.css";

// 画廊页面：从 URL 读取 path/index/name。
// 关闭时持久化阅读进度到后端。
//
// 视觉：沉浸式画廊 — 暗色背景让图片突出，常驻 UI 只留顶部（返回/名称/页码）+ 顶部右侧
//（全屏/菜单），其余控件在鼠标移动时浮出，2s 无操作后自动隐藏。
//
// 页面只留「怎么摆」的部分：取数在 useReaderMedia，键盘在 useReaderKeys，
// 跨卷导航在 useAdjacentAlbum，控件显隐在 useIdleChrome。
export default function Reader() {
  const [params] = useSearchParams();
  const routeParams = useParams();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  const queryClient = useQueryClient();

  // 漫画阅读器的路由是 /comic/read/<album id>。
  const pathParam = decodeURIComponent(routeParams["albumId"] ?? "");
  const initialIndex = Math.max(
    0,
    Math.floor(Number(params.get("index") ?? 0) || 0),
  );
  // type=video 走 VideoPlayer；其它（含未传）走 ImageGallery。
  // 视频播放进度将在独立模型中持久化，不能复用相册的页码进度。
  const typeParam = (params.get("type") ?? "image") as "image" | "video";
  const isVideo = typeParam === "video";
  const isVideoRef = useRef(isVideo);
  isVideoRef.current = isVideo;

  const media = useReaderMedia(pathParam, isVideo);
  const { images, videos, dimensions, reload: reloadMedia } = media;
  const ready = media.status === "ready";

  const [continuousRange, setContinuousRange] = useState({
    path: "",
    startIndex: 0,
    endIndex: 0,
  });
  const [imageActivityReadyPath, setImageActivityReadyPath] = useState("");

  const index = useGalleryStore((s) => s.index);
  const setIndex = useGalleryStore((s) => s.setIndex);
  const slideshow = useGalleryStore((s) => s.slideshow);
  const slideshowInterval = useGalleryStore((s) => s.slideshowInterval);
  const toggleSlideshow = useGalleryStore((s) => s.toggleSlideshow);
  const mode = useGalleryStore((s) => s.mode);

  const [showInfo, setShowInfo] = useState(false);
  const { mode: workbenchMode, setMode: setWorkbenchMode } = useAppMode();
  const [showHelp, setShowHelp] = useState(false);
  // 目录：整本缩略图，按需打开，不打断连续阅读。
  const [showOverview, setShowOverview] = useState(false);
  // 读完一卷后的收尾提示（自动切下一卷关闭时才出现）。
  const [showFinished, setShowFinished] = useState(false);
  // 右键菜单位置(阅读器内任意位置右键都触发)。
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  // 「阅读到末尾自动切换下一卷」「切换时显示通知」两个阅读偏好。
  // 未加载前按服务端默认值处理（都是开启）。
  const { data: prefs } = usePrefs();
  const autoSwitchAlbum = prefs?.autoSwitchAlbum ?? true;
  const showSwitchNotif = prefs?.showSwitchNotif ?? true;
  const [markingRead, setMarkingRead] = useState(false);
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

  // 浮层显隐：鼠标移动时显出，2s 无动作后自动隐藏。
  // 不影响顶部常驻条（始终可见）。
  const { chromeVisible, toolbarVisible, markActive } = useIdleChrome();

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
  const name =
    albumSummary?.displayName ||
    albumSummary?.name ||
    params.get("name") ||
    "画廊";
  // 顶栏里的名字：漫画的卷名只写「第1卷」，这一卷属于哪部作品
  // 看不出来。作品名补在前面，与书封上的写法一致 —— 翻开一本时
  // 顶栏该说的是「星海漫步 · 第1卷」。
  const headerName =
    albumSummary?.parentName && albumSummary.parentName !== name
      ? `${albumSummary.parentName} · ${name}`
      : name;

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
    setContinuousRange({ path: "", startIndex: 0, endIndex: 0 });
    finishedRef.current = false;
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
  const imageActivityPageIndex = displayedPageIndex(
    mode,
    index,
    images.length,
    continuousRange.path === pathParam ? continuousRange : undefined,
  );
  const imageActivityWritable =
    !isVideo && ready && imageActivityReadyPath === pathParam && images.length > 0;

  useEffect(() => {
    if (!imageActivityWritable) return;
    progressRef.current = {
      path: pathParam,
      index: imageActivityPageIndex,
      total: images.length,
    };
  }, [imageActivityPageIndex, imageActivityWritable, images.length, pathParam]);

  // 恢复阅读进度：媒体就绪后按 URL 里的 index 或服务端记录定位。
  //
  // reloadKey 参与依赖：重试时要再恢复一次（失败提示里的「重试进度」
  // 走的就是这条路）。
  useEffect(() => {
    if (!ready) return;
    const list = isVideo ? videos : images;
    if (!isVideo) {
      setIndex(Math.max(0, Math.min(list.length - 1, initialIndex)));
    }
    // 切到新 album 时重置缩放/旋转（视频模式不需要；切视频时由
    // <video key=src> 自然重挂载）
    if (!isVideo) {
      useGalleryStore.getState().resetView();
    }
    if (!pathParam) return;
    // URL 显式带 index= 时表示「用户点了某张图/某条链接」,跳过 progress 恢复
    // — 否则会从后端图片活动拉出上次位置把 initialIndex 顶掉,
    // 导致「点任意图都跳到上次看到的那张」(Album 详情缩略图 / AlbumCard
    // hover preview 跳进来都会撞这个)。
    const hasExplicitIndex = params.has("index");
    if (hasExplicitIndex) {
      if (!isVideo) setImageActivityReadyPath(pathParam);
      return;
    }
    if (isVideo) return;
    let cancelled = false;
    // 这次定位是「恢复」而不是「刚读完」：末页恢复不该弹收尾提示。
    restoringRef.current = true;
    activityApi
      .getImage(pathParam)
      .then((rp) => {
        if (cancelled) return;
        // pageIndex 表示已展示的最末页；双页模式恢复时对齐到跨页左侧。
        const pageIndex = Math.max(0, Math.min(list.length - 1, rp.pageIndex));
        const anchorIndex =
          useGalleryStore.getState().mode === "double"
            ? pageIndex - (pageIndex % 2)
            : pageIndex;
        setIndex(anchorIndex);
        setImageActivityReadyPath(pathParam);
        clearProgressFailure("restore");
      })
      .catch((error) => {
        if (!cancelled && isActivityNotFound(error)) {
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
  }, [ready, pathParam, isVideo, reloadKey]);

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

  const onImageSaved = useCallback(() => clearProgressFailure("save"), [clearProgressFailure]);
  const onImageSaveFailed = useCallback(() => reportProgressFailure("save"), [reportProgressFailure]);
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

  const scrollContinuousTo = useCallback(
    (targetIndex: number) => {
      if (images.length === 0) return;
      // ImageGallery 通过 VirtuosoHandle 监听 store.index 并完成真实滚动；不再
      // 查询可能尚未被虚拟列表挂载的 DOM 节点。
      setIndex(Math.max(0, Math.min(images.length - 1, targetIndex)));
    },
    [images.length, setIndex],
  );

  const onContinuousVisibleRangeChange = useCallback(
    (startIndex: number, endIndex: number) => {
      if (useGalleryStore.getState().mode !== "continuous") return;
      if (images.length === 0) return;
      const nextStartIndex = Math.max(
        0,
        Math.min(images.length - 1, Math.floor(startIndex)),
      );
      const nextEndIndex = Math.max(
        nextStartIndex,
        Math.min(images.length - 1, Math.floor(endIndex)),
      );
      setContinuousRange({
        path: pathParam,
        startIndex: nextStartIndex,
        endIndex: nextEndIndex,
      });
      if (useGalleryStore.getState().index !== nextStartIndex) {
        setIndex(nextStartIndex);
      }
    },
    [images.length, pathParam, setIndex],
  );

  // 切到连续模式后,容器需要滚到当前 index 对应的那张图。
  // ImageGallery 挂载 Virtuoso 后需要用当前 index 完成首次定位，避免用户
  // (尤其从 saved progress 恢复)看到的是 index 0,跟 slider / 计数对不上。
  // 用 ref 标记只在「首次进入 continuous」时跑一次，后续切页由 index 驱动。
  // 注意:首次 mount 模式就是 continuous (galleryStore 从 localStorage 恢复)
  // 也要触发,所以不能用 prevModeRef (初始值就是 continuous,判断失效)。
  const continuousScrolledRef = useRef(false);
  useEffect(() => {
    if (
      !continuousScrolledRef.current &&
      mode === "continuous" &&
      ready &&
      images.length > 0
    ) {
      continuousScrolledRef.current = true;
      // queueMicrotask 确保 Virtuoso ref 已挂载，再由 ImageGallery 滚到目标项。
      queueMicrotask(() => scrollContinuousTo(index));
    } else if (mode !== "continuous") {
      // 离开 continuous 后,允许下次再进入时重新滚一次
      continuousScrolledRef.current = false;
    }
  }, [mode, ready, images.length, index, scrollContinuousTo]);

  // 滚到最后一张：自动标记为「已读」一次。
  useEffect(() => {
    if (isVideo) return;
    if (markingRead) return;
    if (!imageActivityWritable || !pathParam) return;
    if (imageActivityPageIndex < images.length - 1) {
      finishedRef.current = false;
      // 恢复到中间某一页：这次恢复到此为止，之后翻到末页仍算「刚读完」。
      restoringRef.current = false;
      return;
    }
    if (finishedRef.current) return;
    finishedRef.current = true;
    // 恢复到上次位置的那一次不算「刚读完」：那一卷本来就读完了，
    // 打开它不该弹收尾提示。
    const restored = restoringRef.current;
    restoringRef.current = false;
    setMarkingRead(true);
    activityApi
      .setImage(pathParam, images.length - 1, images.length)
      .then(() => {
        clearProgressFailure("save");
        pushToast({ kind: "success", message: "已读完 🎉", ttl: 1500 });
        // 读到末页就是一个明确的结束界面：读完这一卷、还有没有下一卷，
        // 在这里一次说清楚。
        if (!restored) setShowFinished(true);
      })
      .catch(() => reportProgressFailure("save"))
      .finally(() => setMarkingRead(false));
  }, [
    imageActivityPageIndex,
    imageActivityWritable,
    images.length,
    pathParam,
    isVideo,
    markingRead,
    pushToast,
    clearProgressFailure,
    reportProgressFailure,
  ]);

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

  useEffect(() => {
    if (isVideo || !slideshow) return;
    const t = setInterval(() => {
      const cur = useGalleryStore.getState().index;
      const step = mode === "double" ? 2 : 1;
      if (cur + step < images.length) {
        setIndex(cur + step);
      } else {
        // 末尾:对齐手动 next() 的反馈(避免幻灯片 loop 回 0 与
        // 手动翻页的"已是最后一张"行为割裂),toast + 自动停。
        onReachEnd();
      }
    }, slideshowInterval);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideo, slideshow, slideshowInterval, images.length, setIndex, mode]);

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
  const siblingEntries = useSiblingVolumes(albumSummary?.parentId);
  const closeInfo = useCallback(() => setShowInfo(false), []);
  const { goAdjacent, adjacentNames } = useAdjacentAlbum({
    pathParam,
    isVideo,
    onBeforeNavigate: closeInfo,
    fallbackEntries: siblingEntries,
  });
  // 有没有下一卷：跨卷导航算出来的目标卷名就是答案（没有下一卷时
  // 它是空串）。收尾提示据此换一句话、也据此决定要不要留那个按钮。
  const hasNextVolume = Boolean(adjacentNames.next);

  // 已到末尾的统一反馈：toast + 自动停幻灯片。
  // 用 ref 持有,避免 setInterval 闭包捕获旧的 onReachEnd 引用
  // (slideshow effect 的 deps 不包含 pushToast/toggleSlideshow,这些会
  // 因 user 操作 stale,但回调需要读最新 store + push 最新 toast)。
  const onReachEndRef = useRef<() => void>(() => {});
  onReachEndRef.current = async () => {
    // 「阅读到末尾自动切换下一卷」：读完直接进入上下文里的下一卷，
    // 幻灯片也跟着继续（不当作异常终止）。
    if (
      autoSwitchAlbum &&
      (await goAdjacent(1, { notify: showSwitchNotif, albumsOnly: true }))
    ) {
      return;
    }
    pushToast({
      kind: "info",
      message: isVideo
        ? media.siblingCount > 0
          ? `已是最后一个视频 · 相册里另有 ${media.siblingCount} 页图片`
          : "已是最后一个视频"
        : media.siblingCount > 0
          ? `图片已看完 · 还有 ${media.siblingCount} 个视频`
          : "已是最后一页",
      ttl: 1500,
    });
    // 读完一卷后给一个明确的收尾入口：接着读下一卷，或回到相册。
    if (!isVideo) setShowFinished(true);
    if (useGalleryStore.getState().slideshow) {
      toggleSlideshow();
      pushToast({ kind: "info", message: "幻灯片已自动停止" });
    }
  };
  const onReachEnd = useCallback(() => onReachEndRef.current(), []);

  const scrollStep = useCallback((dir: -1 | 1) => {
    const container = document.querySelector(
      "[data-image-gallery]",
    ) as HTMLDivElement | null;
    if (!container) return;
    const delta = container.clientHeight * 0.9 * dir;
    container.scrollBy({ top: delta, behavior: "smooth" });
  }, []);

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
      scrollStep(-1);
      return;
    }
    if (mode === "double") {
      if (index > 0) setIndex(Math.max(0, index - 2));
    } else if (index > 0) {
      setIndex(index - 1);
    }
  }, [isVideo, initialIndex, videos.length, goToVideo, mode, scrollStep, index, setIndex]);

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
      scrollStep(1);
      return;
    }
    if (mode === "double") {
      if (index + 2 < images.length) {
        setIndex(index + 2);
        return;
      }
      if (index < images.length - 1) {
        setIndex(Math.max(0, images.length - 2));
        return;
      }
      onReachEnd();
      return;
    }
    if (index < images.length - 1) {
      setIndex(index + 1);
      return;
    }
    onReachEnd();
  }, [isVideo, initialIndex, videos.length, goToVideo, mode, scrollStep, index, setIndex, images.length, onReachEnd]);

  const jumpTo = useCallback(
    (zeroBased: number) => {
      if (isVideo) {
        goToVideo(zeroBased);
        return;
      }
      const i = Math.max(0, Math.min(images.length - 1, zeroBased));
      setIndex(i);
      // continuous 模式：setIndex 不会自动滚动，单独触发一次
      if (useGalleryStore.getState().mode === "continuous") {
        scrollContinuousTo(i);
      }
    },
    [isVideo, images.length, scrollContinuousTo, setIndex, goToVideo],
  );

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
  const onOpenInExplorer = useCallback(() => {
    const id = currentRef.current;
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
  }, [pushToast]);

  // 把当前展示的图片/视频设为本相册的封面。成功后统一失效摘要查询，
  // 卡片、搜索和阅读器的封面状态会从同一个新 revision 重新读取。
  //
  // 注：current 是在组件后段计算的（依赖 isVideo / images / videos / index），
  // 因此这里在 callback 内通过 useGalleryStore.getState() 读 index、images、videos
  // 实时算 current，避免依赖数组出现 forward reference；每次按键都拿到当前真实文件。
  const onSetCover = useCallback(() => {
    if (!pathParam) return;
    const cur = currentRef.current;
    if (!cur) return;
    albumsApi
      .setCover(pathParam, cur)
      .then(() => {
        setHasCustomCover(true);
        void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.root });
        pushToast({ kind: "success", message: "已设为封面", ttl: 1200 });
      })
      .catch((e) => {
        pushToast({
          kind: "error",
          message: apiErrorMessage(e, "设置封面失败"),
        });
      });
  }, [pathParam, queryClient, pushToast]);

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
      prev,
      next,
      jumpToFirst: () => {
        if (isVideo) {
          goToVideo(0);
        } else if (useGalleryStore.getState().mode === "continuous") {
          scrollContinuousTo(0);
        } else {
          setIndex(0);
        }
      },
      jumpToLast: () => {
        if (isVideo) {
          if (videos.length > 0) goToVideo(videos.length - 1);
        } else if (useGalleryStore.getState().mode === "continuous") {
          scrollContinuousTo(images.length - 1);
        } else {
          setIndex(images.length - 1);
        }
      },
      toggleInfo: () => setShowInfo((v) => !v),
      toggleOverview: () => setShowOverview((v) => !v),
      toggleHelp: () => setShowHelp((v) => !v),
      toggleFinished: () => setShowFinished((v) => !v),
      toggleFavorite: onToggleFavorite,
      setCover: onSetCover,
      clearCover: onClearCover,
      nextAlbum: () => {
        void goAdjacent(1, { notify: showSwitchNotif });
      },
      prevAlbum: () => {
        void goAdjacent(-1, { notify: showSwitchNotif });
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

  if (!ready) {
    return (
      // 阅读器画布恒为深色：加载态、空态、失败态都跟着深色走，
      // 否则浅色主题下会先闪一屏白底，再跳到黑色画布。
      <div className="reader-shell flex flex-col h-full">
        {/* 顶部条：返回 / 名称（常驻） */}
        <div className="px-4 h-[calc(2.25rem+var(--safe-top))] pt-[var(--safe-top)] text-meta text-white/60 border-b border-white/10 bg-overlay-panel/60 flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="px-1.5 py-0.5 rounded hover:bg-white/10 text-white/60 hover:text-white"
            aria-label="返回"
          >
            ←
          </button>
          <span className="font-medium text-white/85 truncate">
            {headerName}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center px-6">
          {media.status === "no-album" ? (
            <div className="text-center">
              <div className="font-display text-section font-semibold text-white/90">
                无可显示的图片
              </div>
              <div className="text-body text-white/50 mt-1.5">
                未指定相册路径
              </div>
            </div>
          ) : media.status === "empty" || media.status === "error" ? (
            <div className="text-center max-w-sm">
              <div className="font-display text-section font-semibold text-white/90 mb-2">
                {media.status === "empty"
                  ? isVideo
                    ? "这个相册没有视频"
                    : "这个相册没有图片"
                  : "加载失败"}
              </div>
              <div className="text-body leading-relaxed text-white/60 mb-6">
                {media.status === "empty"
                  ? isVideo
                    ? "可以换个相册，或检查视频是否已被移动/删除。"
                    : "可以换个相册，或检查文件是否已被移动/删除。"
                  : media.error}
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={goBack}
                  className="px-4 h-9 text-body rounded-md border border-white/15 bg-white/10 hover:bg-white/15 text-white/85 transition-colors"
                >
                  返回
                </button>
                <button
                  type="button"
                  onClick={reload}
                  className="px-4 h-9 text-body rounded-md bg-accent text-accent-contrast hover:opacity-90 transition-opacity"
                >
                  重试
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-body text-white/60">
              <div
                className="w-5 h-5 rounded-full border-2 border-white/40 border-t-transparent animate-spin"
                aria-hidden
              />
              <span>正在加载图片…</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 显示给用户看的 item index（1 / 2 那种）。
  // 视频模式下 current / itemIndex 基于 URL 的 initialIndex，和图片阅读页码
  // 状态保持隔离。
  const current = (isVideo ? currentVideo : images[index]) ?? null;
  // 把 current 同步进 ref,让 onSetCover (声明在前) 拿到最新值。
  currentRef.current = current;
  const total = isVideo ? videos.length : images.length;
  const itemIndex = videoItemIndex;

  return (
    <div
      data-testid="gallery-reader"
      className="reader-shell relative flex overflow-hidden select-none"
      // 用 dvh 而不是 vh：移动端浏览器地址栏收起 / 展开时，100vh 不等于
      // 实际可视高度，底部的页码进度条会被推到屏幕外。
      style={{ height: "100dvh" }}
      onMouseMove={markActive}
      onContextMenu={(e) => {
        // 屏蔽浏览器默认右键菜单(图片另存为等),改用我们自己的。
        // 子组件 (ImageGallery/VideoPlayer) 内部各自 preventDefault + 标记
        // 是图片区,这里统一捕获后弹自定义菜单。
        e.preventDefault();
        if (!pathParam) return;
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* 舞台：画布 + 顶栏 + 浮层控件 + 底部进度条。
          信息面板打开时（md+）这一列横向收缩，面板成为独立的一栏；
          窄屏时面板改为浮在顶栏下方的整宽浮层，不遮挡顶栏。 */}
      <div className="relative flex-1 min-w-0">
        {/* 暗色画布层：让图片有「画廊」氛围 */}
        {/* flex flex-col 是关键：让 ImageGallery 内部的 `flex-1` + `min-h-0`
          容器拿到约束高度,连续模式才能在容器内纵向滚动,
          而不是被外层 overflow-hidden 裁掉。
          上下两条留白留给常驻的顶栏与页码条：它们不淡出，
          压在画面上就等于永久遮住这一页的开头与结尾。 */}
        <div
          className="absolute inset-0 flex flex-col"
          style={{
            paddingTop: "var(--reader-chrome-top)",
            paddingBottom: isVideo ? 0 : "var(--reader-chrome-bottom)",
          }}
        >
          {isVideo ? (
            <VideoPlayer
              src={current ?? ""}
              initialPositionSec={
                videoActivity.resume.key === videoActivityKey
                  ? videoActivity.resume.seconds
                  : undefined
              }
              onMetaLoaded={videoActivity.onMetaLoaded}
              onProgress={videoActivity.onProgress}
              onEnded={() => {
                // onEnded 只会在视频模式下触发（<VideoPlayer> 仅在 isVideo 时渲染）。
                // 从 URL 的 initialIndex 派生当前 item 索引。
                videoActivity.markCompleted();
                const cur = Math.max(
                  0,
                  Math.min(initialIndex, Math.max(0, videos.length - 1)),
                );
                if (cur < videos.length - 1) {
                  goToVideo(cur + 1);
                } else {
                  pushToast({
                    kind: "success",
                    message: "已看完 🎉",
                    ttl: 1500,
                  });
                }
              }}
            />
          ) : (
            <ImageGallery
              images={images}
              dimensions={dimensions}
              onVisibleRangeChange={onContinuousVisibleRangeChange}
              onClickNavigate={(dir) => {
                if (dir === -1) prev();
                else if (dir === 1) next();
              }}
            />
          )}
        </div>

        {/* 顶部常驻条：返回 / 名称 / 页码 / 全屏 / 菜单 */}
        {progressFailure?.key === progressKey && (
          <div
            role="alert"
            className="absolute top-20 left-3 right-3 z-30 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-md border border-overlay-border bg-overlay-panel backdrop-blur-md p-3 text-body text-white/85 shadow-lg"
          >
            <span>
              {progressFailure.operation === "restore"
                ? "无法恢复上次进度，已暂停保存，避免覆盖原记录。"
                : "阅读进度未保存，请重试。"}
            </span>
            <button
              type="button"
              disabled={retryingProgress}
              onClick={() => void retryProgress()}
              className="shrink-0 rounded border border-white/20 px-3 py-1 text-white/85 hover:bg-white/10 disabled:opacity-50"
            >
              {retryingProgress ? "重试中…" : "重试进度"}
            </button>
          </div>
        )}
        <GalleryHeader
          name={headerName}
          index={index}
          itemIndex={isVideo ? itemIndex : undefined}
          total={total}
          isFavorite={isFav}
          onBack={goBack}
          onToggleFavorite={onToggleFavorite}
          onToggleInfo={() => setShowInfo((v) => !v)}
          onToggleHelp={() => setShowHelp((v) => !v)}
          onPrev={prev}
          onNext={next}
          onPrevAlbum={() => void goAdjacent(-1, { notify: showSwitchNotif })}
          onNextAlbum={() => void goAdjacent(1, { notify: showSwitchNotif })}
          onSetCover={onSetCover}
          onClearCover={onClearCover}
          hasCustomCover={hasCustomCover}
          onToggleOverview={() => setShowOverview((v) => !v)}
          workbenchMode={workbenchMode}
          onOpenWorkbench={openWorkbench}
          onJumpToFirst={isVideo ? () => goToVideo(0) : () => setIndex(0)}
          onJumpToLast={
            isVideo
              ? () => {
                  if (videos.length > 0) goToVideo(videos.length - 1);
                }
              : () => setIndex(Math.max(0, images.length - 1))
          }
        />

        {/* 阅读控制：底部浮动工具条（翻页 / 模式 / 适配 / 缩放 / 旋转）。
            它压在画面上，常驻会一直挡着画，所以空闲后淡出，鼠标靠近
            底部就回来；位置信息交给常驻的顶部条与底部页码条。
            视频模式不显示（视频有原生 controls）。 */}
        {!isVideo && (
          <GalleryToolbar
            onPrev={prev}
            onNext={next}
            atStart={index <= 0}
            atEnd={index >= images.length - 1}
            visible={toolbarVisible}
          />
        )}

        {/* 跨卷导航：画面左侧竖排，低频但需要常驻可见 */}
        {!isVideo && (
          <GalleryAlbumNav
            visible={chromeVisible}
            onPrevAlbum={() => void goAdjacent(-1, { notify: showSwitchNotif })}
            onNextAlbum={() => void goAdjacent(1, { notify: showSwitchNotif })}
            prevLabel={adjacentNames.prev}
            nextLabel={adjacentNames.next}
          />
        )}

        {/* 底部进度条 + 跳转：常驻显示。
            它是被动信息（当前在第几张）+ 长相册的主要导航手段（拖拽刮擦 +
            浮出缩略图条），按 idle 淡出会让用户在一本 300 张的漫画里
            彻底失去位置感 —— 而它本身只占 44px。
            视频模式下隐藏（<video> 自带 controls）。 */}
        {!isVideo && (
          <div className="absolute bottom-0 inset-x-0 z-10">
            <PageSlider
              total={images.length}
              index={index}
              onJump={jumpTo}
              images={images}
              double={mode === "double"}
            />
          </div>
        )}
      </div>

      {showInfo && !isVideo && current && (
        <ImageInfoPanel absPath={current} onClose={() => setShowInfo(false)} />
      )}
      {showOverview && !isVideo && (
        <PageOverview
          images={images}
          index={index}
          onJump={(target) => {
            setShowOverview(false);
            jumpTo(target);
          }}
          onClose={() => setShowOverview(false)}
        />
      )}
      {showFinished && !isVideo && (
        <div
          data-testid="reader-finished"
          /* 抬到底部浮动工具条之上：两者都在底部居中，落在同一处时
             收尾提示会压住工具条，工具条从提示底下露出半截，
             像两层没对齐的浮层。 */
          className="absolute inset-x-0 bottom-28 z-30 mx-auto flex w-[min(560px,92vw)] items-center gap-3 rounded-lg border border-overlay-border bg-overlay-panel px-4 py-3 text-white shadow-lg backdrop-blur-md"
        >
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium text-white/90">
              {hasNextVolume ? "这卷读完了" : "这一部读完了"}
            </div>
            <div className="text-meta text-white/55">
              {hasNextVolume
                ? "可以接着读下一卷，或回到书架继续浏览。"
                : "这是这一部的最后一卷，没有下一卷了。"}
            </div>
          </div>
          {/* 没有下一卷时不摆这个按钮：点了只会得到一句「没有下一卷」，
              收尾的地方该说清楚话，不该留一个走不通的入口。 */}
          {hasNextVolume ? (
            <button
              type="button"
              onClick={() => {
                setShowFinished(false);
                void goAdjacent(1, {
                  notify: showSwitchNotif,
                  albumsOnly: true,
                });
              }}
              className="shrink-0 rounded border border-white/20 px-3 py-1.5 text-meta text-white/90 transition-colors hover:bg-white/10"
            >
              下一卷
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setShowFinished(false);
              goBack();
            }}
            className="shrink-0 rounded border border-white/20 px-3 py-1.5 text-meta text-white/90 transition-colors hover:bg-white/10"
          >
            {albumSide === "comic" ? "回到书架" : "回到相册"}
          </button>
          <button
            type="button"
            onClick={() => setShowFinished(false)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            title="关闭"
            aria-label="关闭读完提示"
          >
            <CloseIcon size={13} />
          </button>
        </div>
      )}
      <HelpOverlay
        context={isVideo ? "video" : "image"}
        open={showHelp}
        onClose={() => setShowHelp(false)}
        tone="reader"
      />
      {/* 右键菜单：阅读器内任意位置右键都弹出。
          「设为封面」「清除自定义封面」用与 GalleryHeader 同一份 handler，
          保证快捷键 U / ⇧U 与菜单行为完全一致。 */}
      {contextMenu && pathParam && current && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          tone="reader"
          items={
            [
              {
                id: "set-cover",
                label: "设为封面 (U)",
                icon: <ImageIcon />,
              },
              hasCustomCover
                ? {
                    id: "clear-cover",
                    label: "清除自定义封面 (⇧U)",
                    icon: <RefreshIcon />,
                  }
                : {
                    id: "clear-cover-disabled",
                    label: "清除自定义封面",
                    disabled: true,
                  },
              { id: "separator", separator: true },
              {
                id: "explorer",
                label: "在文件管理器中打开",
                icon: <ArrowUpRightIcon />,
                disabled: !allowOsOpen,
              },
            ] satisfies AnyMenuItem[]
          }
          onSelect={(id) => {
            setContextMenu(null);
            if (id === "set-cover") onSetCover();
            else if (id === "clear-cover") onClearCover();
            else if (id === "explorer") onOpenInExplorer();
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
