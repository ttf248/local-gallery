import { ViewerChrome } from "./ViewerChrome";
import { useIdleChrome } from "../../hooks/useIdleChrome";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { useZoomTransition } from "./useZoomTransition";
import { Filmstrip } from "./Filmstrip";
import { RotateIcon, GridIcon } from "../../ui/icons";
import { Link } from "react-router-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { previewUrl } from "../../api/images";
import {
  useVisitRecorder,
  VISIT_COOLDOWN_MS,
} from "../../hooks/useVisitRecorder";
import {
  devicePixelRatio,
  fitPreviewWidth,
  pickRenditionWidth,
} from "../../utils/rendition";
import type { LibraryMediaItem } from "../../api/library";
import { isFullscreen, toggleFullscreen } from "../../utils/fullscreen";
import { shouldIgnoreShortcut } from "../../utils/shortcuts";
import { usePhotoStore } from "../../store/photoStore";
import { useUIStore } from "../../store/uiStore";
import VideoPlayer from "./VideoPlayer";
import ImageInfoPanel from "./ImageInfoPanel";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoublePageIcon,
  FullscreenIcon,
  InfoIcon,
  MinusIcon,
  PickIcon,
  SearchIcon,
  PlusIcon,
  StarIcon,
} from "../../ui/icons";

export interface PhotoViewerProps {
  /**
   * 照片墙上的媒体序列（图片与视频混合）。
   *
   * 跨相册的序列（首页照片墙、年份墙、足迹、精选）里的每一项带着它
   * 出自哪本相册：翻到哪一张，「最近浏览」就记哪一本。
   */
  items: (LibraryMediaItem & {
    albumId?: string;
    albumName?: string;
    dateValue?: string;
    capturedAt?: string;
  })[];
  /** 当前查看的序号（0 基）。 */
  index: number;
  /** 相册名，用于标题与信息。 */
  albumName: string;
  /**
   * 这一串照片属于哪本相册。
   *
   * 相册内的照片墙里每一项都出自同一本，序列本身不携带出处，用这个
   * 补上；跨相册的序列不用传 —— 每一项自己知道出处。
   */
  albumId?: string;
  /**
   * 回到相册的地址。
   *
   * 精选页的照片来自不同相册，标题只说「这是哪本里的」还不够 ——
   * 点一下能回到那本才接得上。给了地址时标题变成链接。
   */
  albumHref?: string;
  /**
   * 相册里的媒体总数。
   *
   * 不传就用已加载的条目数 —— 但照片墙是分页加载的，只报已加载的
   * 数量会与页头那个「403 张」对不上：同一本相册在两处报两个数，
   * 用户只会以为其中一个是错的。
   */
  totalCount?: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /**
   * 还有下一页可取。
   *
   * 大图预览原本只能在「已经加载进来的那一段」里翻：年度照片墙有几千张，
   * 但墙是分页加载的，翻到已加载的末尾就走不动了 —— 用户以为照片只有
   * 这么些。给了这三个属性，预览就能在末尾自动接上下一页。
   */
  hasNextPage?: boolean;
  /** 正在取下一页。 */
  isLoadingMore?: boolean;
  /** 取下一页失败：已加载的内容仍可浏览，但要给一个重试的手柄。 */
  loadMoreError?: boolean;
  /** 取下一页。 */
  onLoadMore?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onSetCover?: () => void;
  hasCustomCover?: boolean;
  /** 这张照片是否在精选里。 */
  isPicked?: boolean;
  /** 把这张照片加入 / 移出精选。 */
  onTogglePick?: () => void;
  /** 以当前照片作为查询图，查找语义相似的照片。 */
  onFindSimilar?: () => void;
  /** 这张照片是否已经放进「待对比」的那一格。 */
  comparePinned?: boolean;
  /** 放进待对比 / 与待对比的那张并排。 */
  onToggleCompare?: () => void;
  /**
   * 并排对比是否正开在这层之上。
   *
   * 两层浮层不抢同一个键：对比开着的时候，预览不响应翻页与 Esc ——
   * 否则按一次 Esc 会把两层一起收掉。
   */
  compareOpen?: boolean;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.25;

/**
 * 离末尾还剩几张时开始预加载下一页。
 *
 * 三张足够盖住一次取页的往返：用户连按几下「下一张」时，页面多半已经
 * 在路上了。再多就是白白多取一页，用户未必看得到。
 */
const PRELOAD_AHEAD = 3;

/**
 * 最多记住多少次「下一张」等着补。
 *
 * 按住不放时用户可能按几百次 —— 上限要留得住这些次数，否则按住不放
 * 翻到分页边界就会「吃掉」一截按键。真正补多少由已加载的条目决定：
 * 没有那么多照片就补那么多，所以这个上限只是防住荒谬的数字。
 */
const MAX_PENDING_ADVANCE = 10000;

/**
 * 照片模式的沉浸式大图预览。
 *
 * 与漫画阅读器刻意分开：这里没有页码概念、没有双页、没有 RTL，
 * 只有「看这一张 → 下一张 → 上一张」。缩放、拖动、全屏与键盘操作
 * 在看图场景里是基本动作，而不是阅读器的附属功能。
 */
export default function PhotoViewer({
  items,
  index,
  albumName,
  albumId,
  albumHref,
  totalCount,
  onIndexChange,
  onClose,
  hasNextPage = false,
  isLoadingMore = false,
  loadMoreError = false,
  onLoadMore,
  isFavorite,
  onToggleFavorite,
  onSetCover,
  hasCustomCover,
  isPicked,
  onTogglePick,
  onFindSimilar,
  comparePinned,
  onToggleCompare,
  compareOpen = false,
}: PhotoViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const showInfo = usePhotoStore((s) => s.showInfo);
  const setShowInfo = usePhotoStore((s) => s.setShowInfo);
  const [stripVisible, setStripVisible] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [loadedId, setLoadedId] = useState("");
  const { chromeVisible } = useIdleChrome();
  const reducedMotion = useReducedMotion();
  const [failed, setFailed] = useState(false);

  // 浮层打开时接管单键：全局的 r / u 必须让位，否则按 r 会一边旋转
  // 一边跳走整页。关掉时立刻交还。
  const setImmersiveOverlay = useUIStore((s) => s.setImmersiveOverlay);
  useEffect(() => {
    setImmersiveOverlay(true);
    return () => setImmersiveOverlay(false);
  }, [setImmersiveOverlay]);

  // 原生 <dialog> 的模态：焦点被关在这一层里，背景读屏器够不着，
  // Tab 不会跑到背后的照片墙上去。关掉时把焦点还给打开它的那张照片。
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        previous !== document.body
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fittedRef = useRef({ width: 0, height: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);

  // 跨页连续浏览的几件状态。
  //
  // loadedCount 是上一次看到的已加载条数：条目变多说明新的一页到了。
  // pending 是用户已经按了「下一张」多少次、但那些位置还没加载出来 ——
  // 页到了就一次性补上，用户不必一张张再按。
  // requesting 记着「已经请求过了」：预加载与用户按键可能同时触发，
  // 不记一笔就会发两次同样的请求。
  const loadedCountRef = useRef(items.length);
  const pendingRef = useRef(0);
  // End 是显式跳到当前序列末尾：分页尚未结束时逐页加载，最后一页到达后
  // 再定位，避免把「最后一张」误解为「目前已加载的最后一张」。
  const pendingEndRef = useRef(false);
  const requestingRef = useRef(false);
  // 当前应该在第几张。
  //
  // 连按「下一张」时 props 里的 index 还没跟上（一次按键只改一次状态，
  // 渲染要等这一拍结束）：按 props 算会把好几次按键算成同一张，
  // 照片就在原地不动。这里记的是「已经翻到哪儿」，按键时立刻记账。
  const indexRef = useRef(index);

  const current = items[index];
  const transitionRef = useRef<HTMLDivElement>(null);
  const entered = useRef(false);
  const closing = useRef(false);
  const sourceTile = useCallback(
    () =>
      current &&
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-media-id]"),
      ).find((tile) => tile.dataset.mediaId === current.id),
    [current],
  );
  const getSourceRect = useCallback(
    () => sourceTile()?.getBoundingClientRect() ?? null,
    [sourceTile],
  );
  const { enter, exit } = useZoomTransition({ getSourceRect, reducedMotion });
  const thumbnail = useMemo(
    () => sourceTile()?.querySelector("img")?.currentSrc,
    [sourceTile],
  );
  const close = () => {
    if (closing.current) return;
    const el = transitionRef.current;
    if (!el?.animate) {
      onClose();
      return;
    }
    closing.current = true;
    void exit(el).then(onClose);
  };
  const isVideo = current?.kind === "video";

  // 看照片＝看过那本相册。
  //
  // 「最近浏览」记的是相册：照片侧没有阅读位置，用户翻的是照片，
  // 落点却是相册 —— 他刚在看哪一本相册，是这一页要回答的问题。
  // 翻到哪一张就记它出自的那本；相册内的照片墙每一张都出自同一本，
  // 序列不携带出处时用 albumId 补上。
  const recordVisit = useVisitRecorder();
  const currentAlbumId = current?.albumId ?? albumId;
  const currentAlbumName = current?.albumName ?? albumName;
  useEffect(() => {
    if (!currentAlbumId) return;
    recordVisit(
      currentAlbumId,
      { name: currentAlbumName },
      { cooldownMs: VISIT_COOLDOWN_MS },
    );
  }, [currentAlbumId, currentAlbumName, recordVisit]);

  // 舞台尺寸：图片真正显示多大由它决定。
  //
  // 先量再取图：尺寸没量到就发请求会先要一张视口宽的图（常常直接命中
  // 4096 档的原图），量到之后再改 URL 等于白拉一次。
  const [stageSize, setStageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [stageMeasured, setStageMeasured] = useState(false);

  useEffect(() => {
    if (entered.current || !transitionRef.current || !stageMeasured || !current)
      return;
    entered.current = true;
    void enter(
      transitionRef.current,
      (current.width ?? 0) / (current.height ?? 0),
    );
  }, [stageMeasured, current, enter]);

  // 放大时按放大倍数向上一档取图：否则放大看到的只是被拉大的像素。
  // 档位固定，缩放过程中 URL 只在跨档时变一次，不会来回重下。
  const previewWidth = useMemo(() => {
    const factor = Math.max(1, zoom);
    if (stageSize) {
      return fitPreviewWidth({
        stageWidth: stageSize.width,
        stageHeight: stageSize.height,
        imageWidth: current?.width,
        imageHeight: current?.height,
        zoom: factor,
      });
    }
    // 舞台还没量到：先按视口宽估一档，宁可多要一点也别先要一张 320 的
    // 小图再升级。
    const viewportWidth =
      typeof window === "undefined" ? 1600 : window.innerWidth;
    return pickRenditionWidth(viewportWidth * factor, devicePixelRatio());
  }, [stageSize, current?.width, current?.height, zoom]);

  const clampPan = useCallback(
    (next: { x: number; y: number }, scale: number) => {
      const fitted = fittedRef.current;
      const maxX = Math.max(0, (fitted.width * (scale - 1)) / 2);
      const maxY = Math.max(0, (fitted.height * (scale - 1)) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, next.x)),
        y: Math.max(-maxY, Math.min(maxY, next.y)),
      };
    },
    [],
  );

  const measureFitted = useCallback(() => {
    const element = imageRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const scale = zoom > 0 ? zoom : 1;
    fittedRef.current = {
      width: rect.width / scale,
      height: rect.height / scale,
    };
  }, [zoom]);

  const applyZoom = useCallback(
    (next: number) => {
      const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
      setZoom(scale);
      setPan((current) => clampPan(current, scale));
    },
    [clampPan],
  );

  // 要下一页：已经在请求中就不再发一次。
  const requestMore = useCallback(() => {
    if (!onLoadMore || !hasNextPage) return;
    if (requestingRef.current) return;
    requestingRef.current = true;
    onLoadMore();
  }, [hasNextPage, onLoadMore]);

  const go = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      // 按「已经翻到哪儿」算，不是按 props：连按的时候 props 还没跟上。
      const current = indexRef.current;
      const next = current + delta;
      if (next < 0) return;
      if (next < items.length) {
        // 已加载的范围内：直接换。
        indexRef.current = next;
        pendingRef.current = 0;
        onIndexChange(next);
        return;
      }
      // 已到已加载的末尾：记下这一次「下一张」，并去取下一页。
      //
      // 记的是次数而不是「待处理」：按住不放时用户按了十几次，
      // 页到了就该一次翻过那十几张，而不是只走一张。
      if (delta > 0) {
        pendingRef.current = Math.min(
          pendingRef.current + delta,
          MAX_PENDING_ADVANCE,
        );
        requestMore();
      }
    },
    [items.length, onIndexChange, requestMore],
  );

  // 新的一页到了：解锁请求，并兑现待处理的 End 或「用户已经按过的次数」。
  useEffect(() => {
    if (items.length <= loadedCountRef.current) return;
    loadedCountRef.current = items.length;
    requestingRef.current = false;
    if (pendingEndRef.current) {
      if (hasNextPage && onLoadMore) {
        requestMore();
      } else {
        pendingEndRef.current = false;
        pendingRef.current = 0;
        const lastIndex = items.length - 1;
        indexRef.current = lastIndex;
        onIndexChange(lastIndex);
      }
      return;
    }
    if (pendingRef.current <= 0) return;
    const available = items.length - 1 - indexRef.current;
    const advance = Math.min(pendingRef.current, Math.max(0, available));
    pendingRef.current -= advance;
    if (advance <= 0) return;
    const next = indexRef.current + advance;
    indexRef.current = next;
    onIndexChange(next);
  }, [items.length, hasNextPage, onLoadMore, onIndexChange, requestMore]);

  // 位置只在真的被换到更靠后时才跟回去。
  //
  // props 有可能是先前那次请求的回声（渲染慢了一拍）：连按到分页边界
  // 时，预览一次跳过十几张，父组件渲染出来的中间值会落在 ref 后面。
  // 跟回去就等于把已经翻过去的照片又退回来。父组件把位置换到别处
  // （重新定位）时给的是更靠后的序号，那时才跟。
  useEffect(() => {
    if (index > indexRef.current) {
      indexRef.current = index;
    }
  }, [index]);

  // 预加载：离末尾还有三张时就先把下一页取来，翻到末尾时不必等。
  useEffect(() => {
    if (!hasNextPage || !onLoadMore) return;
    if (items.length === 0) return;
    if (index < items.length - PRELOAD_AHEAD) return;
    requestMore();
  }, [hasNextPage, onLoadMore, index, items.length, requestMore]);

  // 取页失败：解锁请求，让用户再按一次「下一张」就能重试，
  // 而不是卡在末尾只能去点那枚重试按钮。
  useEffect(() => {
    if (loadMoreError) requestingRef.current = false;
  }, [loadMoreError]);

  // 下一张的图先解一遍：翻页时直接显示，不等网络。
  useEffect(() => {
    const next = items[index + 1];
    if (!next || next.kind !== "image" || !stageMeasured) return;
    const image = new Image();
    image.src = previewUrl(next.id, previewWidth, next.version);
  }, [items, index, previewWidth, stageMeasured]);

  // 切换照片时复位缩放与位移：新图不应该带着上一张的放大状态出现。
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFailed(false);
    setRotation(0);
  }, [current?.id]);

  useEffect(() => {
    const onResize = () => measureFitted();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measureFitted]);

  // 量舞台尺寸：决定图片实际显示多大，也就决定了该拉哪一档的图。
  //
  // 用 layout effect 而不是 effect：DOM 提交后同一拍里就能量到，
  // 图片的 src 一次成型，不会先发一版请求再改。
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const rect = stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setStageSize((prev) =>
        prev && prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
      setStageMeasured(true);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      // 没有 ResizeObserver 的环境（老浏览器、测试）也把状态收尾，
      // 图片照常显示，只是按视口宽估档。
      setStageMeasured(true);
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // 滚轮缩放：覆盖层吃掉了页面滚动，普通滚轮直接用来缩放更符合看图习惯。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom((current) => {
        const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current * factor));
        setPan((panNow) => clampPan(panNow, scale));
        return scale;
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [clampPan]);

  // 全局按键只装一次。
  //
  // 监听器原本挂在依赖数组上：父组件每渲染一次，监听就摘掉重装一遍
  // （翻页、缩放、切信息面板都会触发）。摘掉的那一刻正好落在两次
  // 按键之间还好，落在渲染中间就会漏掉一次按键。改成把处理函数放在
  // ref 里、监听只装一次，处理函数始终是最新的一份。
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event)) return;
      // 并排对比开在这层之上时，预览不接按键：Esc 归对比，
      // 翻页也不该在看不见的预览里发生。
      if (compareOpen) return;
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          // 信息面板开着时，Esc 先收面板，不直接退出大图：
          // 面板自己没有 Esc 处理，事件会落到这里的全局监听上。
          // 一次 Esc 关掉面板，再一次才退出预览，两层浮层才分得清。
          if (showInfo) {
            setShowInfo(false);

            break;
          }
          close();
          break;
        case "ArrowLeft":
          event.preventDefault();
          go(-1);
          break;
        case "ArrowRight":
          event.preventDefault();
          go(1);
          break;
        case "Home":
          event.preventDefault();
          indexRef.current = 0;
          onIndexChange(0);
          break;
        case "End":
          event.preventDefault();
          if (items.length === 0) break;
          pendingRef.current = 0;
          if (hasNextPage && onLoadMore) {
            pendingEndRef.current = true;
            requestMore();
          } else {
            pendingEndRef.current = false;
            const lastIndex = items.length - 1;
            indexRef.current = lastIndex;
            onIndexChange(lastIndex);
          }
          break;
        case "+":
        case "=":
          event.preventDefault();
          applyZoom(zoom * ZOOM_STEP);
          break;
        case "-":
          event.preventDefault();
          applyZoom(zoom / ZOOM_STEP);
          break;
        case "0":
          event.preventDefault();
          applyZoom(1);
          setPan({ x: 0, y: 0 });
          break;
        case "f":
        case "F":
          event.preventDefault();
          toggleFullscreen();
          break;
        case "i":
        case "I":
          event.preventDefault();
          setShowInfo(!showInfo);
          break;
        case "p":
        case "P":
          // 精选这一张：照片级的事，与相册级的收藏不是一回事。
          if (!onTogglePick) break;
          event.preventDefault();
          onTogglePick();
          break;
        case "c":
        case "C":
          // 视频没有可并排的画面：对比只对图片开放。
          if (!onToggleCompare || isVideo) break;
          event.preventDefault();
          onToggleCompare();
          break;
        default:
          break;
      }
    };
    keyHandlerRef.current = onKey;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!current) return null;

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    if (event.pointerType === "touch") {
      const points = touchPoints.current;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      event.currentTarget.setPointerCapture?.(event.pointerId);
      if (points.size === 2) {
        const [a, b] = Array.from(points.values());
        pinch.current = {
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          zoom,
        };
        dragRef.current = null;
        swipeRef.current = null;
        return;
      }
    }
    swipeRef.current = { x: event.clientX, y: event.clientY };
    if (zoom > 1) {
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: pan.x,
        originY: pan.y,
        moved: false,
      };
      (event.target as Element).setPointerCapture?.(event.pointerId);
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (touchPoints.current.has(event.pointerId)) {
      touchPoints.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (pinch.current && touchPoints.current.size === 2) {
        const [a, b] = Array.from(touchPoints.current.values());
        applyZoom(
          (pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) /
            pinch.current.distance,
        );
        return;
      }
    }
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    setPan(clampPan({ x: drag.originX + dx, y: drag.originY + dy }, zoom));
  };

  const onPointerUp = (event: React.PointerEvent) => {
    touchPoints.current.delete(event.pointerId);
    if (pinch.current) {
      pinch.current = null;
      swipeRef.current = null;
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) {
      swipeRef.current = null;
      return;
    }
    const swipe = swipeRef.current;
    swipeRef.current = null;
    if (!swipe || zoom > 1) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (event.pointerType === "touch" && dy > 120 && dy > Math.abs(dx) * 1.2) {
      close();
      return;
    }
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      go(dx < 0 ? 1 : -1);
    }
  };

  const onDoubleClick = () => {
    if (zoom > 1) {
      applyZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      applyZoom(2);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      data-testid="photo-viewer"
      className="fixed inset-0 m-0 flex h-full max-h-none w-full max-w-none flex-col border-0 bg-theater-bg p-0 text-theater-fg backdrop:bg-transparent"
      onCancel={(event) => {
        event.preventDefault();
        if (!compareOpen) {
          if (showInfo) setShowInfo(false);
          else close();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${albumName} 大图预览`}
    >
      <ViewerChrome chromeVisible={chromeVisible} onClose={close} albumHref={albumHref} albumName={albumName} date={current.dateValue || current.capturedAt?.slice(0, 10)} multiple={items.length > 1} index={index} total={totalCount ?? items.length}>
        <div className="flex items-center gap-0.5">
          {!isVideo && (
            <button
              type="button"
              aria-label="旋转照片"
              className="grid size-9 place-items-center rounded-full hover:bg-white/10"
              onClick={() => setRotation((r) => (r + 90) % 360)}
            >
              <RotateIcon size={16} />
            </button>
          )}
          {items.length > 1 && (
            <button
              type="button"
              aria-label="胶片条"
              aria-pressed={stripVisible}
              className="grid size-9 place-items-center rounded-full hover:bg-white/10"
              onClick={() => setStripVisible((v) => !v)}
            >
              <GridIcon size={16} />
            </button>
          )}

          {/* 相册级收藏：这颗星说的是「这一本值得留着」。 */}
          {onToggleFavorite && (
            <button
              type="button"
              onClick={onToggleFavorite}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              title={isFavorite ? "取消收藏这本相册" : "收藏这本相册"}
              aria-label={isFavorite ? "取消收藏这本相册" : "收藏这本相册"}
            >
              <StarIcon size={15} filled={isFavorite} />
            </button>
          )}
          {/* 照片级精选：这个勾说的是「这一张值得留着」。
              与上面的星标形状与颜色都不同，两件事不该看着像一件。 */}
          {onTogglePick && (
            <button
              type="button"
              onClick={onTogglePick}
              aria-pressed={isPicked}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                isPicked
                  ? "bg-white/20 text-white"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              }`}
              title={isPicked ? "移出精选 (P)" : "加入精选 (P)"}
              aria-label={isPicked ? "把这张移出精选" : "把这张加入精选"}
            >
              <PickIcon size={16} />
            </button>
          )}
          {onToggleCompare && !isVideo && (
            <button
              type="button"
              onClick={onToggleCompare}
              aria-pressed={comparePinned}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                comparePinned
                  ? "bg-white/20 text-white"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              }`}
              title={
                comparePinned
                  ? "已放进对比，换一张按 C 即可并排"
                  : "放进对比 (C)"
              }
              aria-label="放进并排对比"
            >
              <DoublePageIcon size={15} />
            </button>
          )}
          {onSetCover && (
            <button
              type="button"
              onClick={onSetCover}
              className="hidden h-9 items-center gap-1.5 rounded-md px-2.5 text-caption text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:inline-flex"
              title={hasCustomCover ? "更换封面" : "设为封面"}
            >
              设为封面
            </button>
          )}
          {onFindSimilar && !isVideo && (
            <button
              type="button"
              onClick={onFindSimilar}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              title="查找相似照片"
              aria-label="查找相似照片"
            >
              <SearchIcon size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowInfo(!showInfo)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            title="图片信息 (I)"
            aria-label="图片信息"
          >
            <InfoIcon size={15} />
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            title={isFullscreen() ? "退出全屏 (F)" : "全屏 (F)"}
            aria-label="全屏"
          >
            <FullscreenIcon size={15} />
          </button>
        </div>
      </ViewerChrome>

      {/* 画布 */}
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={stageRef}
          className="relative flex min-h-0 min-w-0 flex-1 touch-none items-center justify-center overflow-hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(e) => {
            touchPoints.current.delete(e.pointerId);
            pinch.current = null;
            dragRef.current = null;
            swipeRef.current = null;
          }}
          onDoubleClick={onDoubleClick}
        >
          {isVideo ? (
            <div className="h-full w-full p-4">
              {/* 方向键在这一侧是「上一张 / 下一张」：视频若也抢这两个键，
                  翻到视频时照片就再也翻不动了。 */}
              <VideoPlayer
                src={current.id}
                className="h-full w-full"
                seekWithArrows={false}
              />
            </div>
          ) : failed || current.undecodable ? (
            <div className="px-6 text-center text-body text-theater-fg">
              <p>这张照片读不出来</p>
              <p className="my-2 text-caption">{current.name}</p>
              {albumHref && (
                <Link className="underline" to={albumHref}>
                  在相册中打开
                </Link>
              )}
            </div>
          ) : (
            <div
              ref={transitionRef}
              className="relative flex h-full w-full items-center justify-center md:p-6"
            >
              {thumbnail && loadedId !== current.id && (
                <img
                  aria-hidden
                  alt=""
                  src={thumbnail}
                  className="pointer-events-none absolute inset-0 h-full w-full object-contain md:p-6"
                />
              )}
              {stageMeasured && (
                <img
                  key={current.id}
                  ref={imageRef}
                  src={previewUrl(current.id, previewWidth, current.version)}
                  alt={current.name}
                  decoding="async"
                  onLoad={() => {
                    setLoadedId(current.id);
                    measureFitted();
                  }}
                  onError={() => setFailed(true)}
                  draggable={false}
                  className="max-h-full max-w-full select-none object-contain"
                  style={{
                    transform:
                      "translate(" +
                      pan.x +
                      "px, " +
                      pan.y +
                      "px) scale(" +
                      zoom +
                      ") rotate(" +
                      rotation +
                      "deg)",
                    cursor: zoom > 1 ? "grab" : "default",
                  }}
                />
              )}
            </div>
          )}
          {zoom === 1 &&
            !isVideo &&
            ([-1, 1] as const).map((step) => (
              <button
                key={step}
                type="button"
                tabIndex={-1}
                aria-label={step < 0 ? "翻到上一张" : "翻到下一张"}
                disabled={
                  step < 0
                    ? index <= 0
                    : index + 1 >= items.length && !hasNextPage
                }
                className={
                  "absolute inset-y-0 hidden w-[15%] items-center justify-center text-white opacity-0 hover:opacity-100 disabled:pointer-events-none md:flex " +
                  (step < 0 ? "left-0" : "right-0")
                }
                onClick={() => go(step)}
              >
                <span className="grid size-12 place-items-center rounded-full bg-black/55">
                  {step < 0 ? <ChevronLeftIcon /> : <ChevronRightIcon />}
                </span>
              </button>
            ))}
        </div>

        {showInfo && !isVideo && (
          <div className="relative h-full w-[min(360px,75%)] shrink-0 overflow-auto bg-theater-surface [&>aside]:static [&>aside]:h-full [&>aside]:w-full">
            <ImageInfoPanel
              absPath={current.id}
              albumName={currentAlbumName}
              albumHref={albumHref}
              onClose={() => setShowInfo(false)}
            />
          </div>
        )}
      </div>

      {/* 底栏：上一张 / 下一张与缩放。
          控件收进一枚半透明药丸：一排散落的图标悬在黑底上像几枚
          掉出来的按键，药丸把它们收成一件工具。 */}
      <footer
        className={
          "relative flex h-12 shrink-0 items-center justify-center gap-3 px-3 transition-opacity focus-within:opacity-100 sm:px-5 " +
          (chromeVisible ? "" : "opacity-0")
        }
      >
        {/* 取下一页的反馈：翻到末尾时用户会等，这一栏告诉他「正在取」，
            失败时给一个重试的手柄，而不是让下一张按钮灰着不动。 */}
        <div
          className="flex items-center gap-2 text-caption"
          aria-live="polite"
          data-testid="photo-viewer-more"
        >
          {loadMoreError ? (
            <>
              <span className="text-white/70">后续照片加载失败</span>
              <button
                type="button"
                onClick={() => {
                  requestingRef.current = false;
                  requestMore();
                }}
                className="rounded-md bg-white/15 px-2.5 py-1 text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                重试
              </button>
            </>
          ) : isLoadingMore ? (
            <span className="text-white/70">正在加载下一张…</span>
          ) : null}
        </div>
        <div className="inline-flex items-center gap-1 rounded-full bg-white/10 p-1 backdrop-blur-sm ring-1 ring-white/10">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index <= 0}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            title="上一张 (←)"
            aria-label="上一张"
          >
            <ChevronLeftIcon size={16} />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            /* 还有下一页时不能灰：灰掉等于告诉用户「后面没有了」，
               而事实是还没取。 */
            disabled={index >= items.length - 1 && !hasNextPage}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            title="下一张 (→)"
            aria-label="下一张"
          >
            <ChevronRightIcon size={16} />
          </button>
          {!isVideo && (
            <div className="ml-1 flex items-center gap-1 border-l border-white/15 pl-2">
              <button
                type="button"
                onClick={() => applyZoom(zoom / ZOOM_STEP)}
                disabled={zoom <= MIN_ZOOM}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                title="缩小 (-)"
                aria-label="缩小"
              >
                <MinusIcon size={15} />
              </button>
              <span className="w-14 text-center text-caption tabular-nums text-white/75">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => applyZoom(zoom * ZOOM_STEP)}
                disabled={zoom >= MAX_ZOOM}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                title="放大 (+)"
                aria-label="放大"
              >
                <PlusIcon size={15} />
              </button>
            </div>
          )}
        </div>
      </footer>
      {stripVisible && items.length > 1 && (
        <Filmstrip items={items} index={index} onChange={onIndexChange} />
      )}
    </dialog>
  );
}
