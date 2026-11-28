import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type PointerEvent,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useGalleryStore } from "../../store/galleryStore";
import { imageUrl, previewUrl } from "../../api/images";
import {
  layoutPages,
  spreadAt,
  validSize,
  type Size,
  type PageBox,
  type Rotation,
} from "./readerLayout";
import {
  useReaderViewport,
  type JumpSource,
  type ReaderObservation,
  type ReaderJump,
  type ReaderViewportHandle,
} from "./useReaderViewport";
interface Props {
  albumId?: string;
  request?: ReaderJump;
  viewportRef?: Ref<ReaderViewportHandle>;
  onJump?: (index: number, source: JumpSource) => void;
  onObserve?: (value: ReaderObservation) => void;
  onInvalidate?: (
    requestEpoch: number,
    relayout: boolean,
    reindexedTarget?: number,
  ) => number;
  images: string[];
  /** 每页的原始像素尺寸。连续模式按它预留高度，图片加载前后页面不跳。 */
  dimensions?: Record<string, { width: number; height: number }>;
  /** 点击图片时触发：根据 clickX 在容器宽度的左/中/右决定动作。父组件传入 prev/next 即可。 */
  footer?: React.ReactNode;
  onClickNavigate?: (dir: -1 | 0 | 1) => void;
}

type DecodedSize = { size: Size; original: boolean };
const continuousParts = {
  Footer: ({ context }: { context?: { footer?: React.ReactNode } }) => (
    <>{context?.footer}</>
  ),
};
const steps = [320, 640, 1280, 1920, 2560, 4096];
function previewWidth(width: number, source?: Size) {
  const wanted = Math.min(
    width * Math.min(window.devicePixelRatio || 1, 2),
    source?.width ?? Infinity,
  );
  return steps.find((w) => w >= wanted) ?? 4096;
}
function PageImage({
  box,
  rotation,
  url,
  onDecode,
}: {
  box: PageBox;
  rotation: Rotation;
  url: string;
  onDecode: (img: HTMLImageElement) => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={`漫画第 ${box.index + 1} 页`}
      data-reader-page={box.index}
      data-file-id={box.fileId}
      className="absolute overflow-hidden"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      {failed === url ? (
        <div className="grid h-full place-content-center gap-2 text-center text-theater-fg">
          <span>第 {box.index + 1} 页</span>
          <span>该图片无法显示</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFailed(null);
            }}
          >
            重试
          </button>
        </div>
      ) : (
        <img
          alt={`第 ${box.index + 1} 页`}
          src={url}
          draggable={false}
          decoding="async"
          onLoad={(e) => onDecode(e.currentTarget)}
          onError={() => setFailed(url)}
          className="absolute left-1/2 top-1/2 max-w-none select-none"
          style={{
            width: box.imageWidth,
            height: box.imageHeight,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          }}
        />
      )}
    </div>
  );
}
export default function ImageGallery({
  albumId = "",
  images,
  dimensions,
  ...rest
}: Props) {
  const { request, viewportRef, onObserve, onInvalidate, onClickNavigate } =
    rest;
  const { index, zoom, rotation, mode, fit, direction, coverOffset } =
    useGalleryStore();
  const container = useRef<HTMLDivElement | null>(null),
    virtuoso = useRef<VirtuosoHandle>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [decoded, setDecoded] = useState<Record<string, DecodedSize>>({});
  const fallback = useMemo(() => {
    const ratios = Object.values(dimensions ?? {})
      .filter(validSize)
      .map((s) => s.height / s.width)
      .sort((a, b) => a - b);
    return {
      width: 900,
      height: 900 * (ratios[Math.floor(ratios.length / 2)] ?? 1.5),
    };
  }, [dimensions]);
  const layoutKey = [
    mode,
    fit,
    direction,
    rotation,
    zoom,
    viewport.width,
    viewport.height,
  ].join("/");
  const geometry = useMemo(
    () => ({ dimensions, decoded }),
    [dimensions, decoded],
  );
  const view = useReaderViewport({
    albumId,
    images,
    index,
    mode,
    rotation,
    request: request ?? { epoch: index, index, source: "key" },
    layoutKey,
    onJump: rest.onJump,
    geometry,
    virtuoso,
    onObserve,
    onInvalidate,
  });
  const { setScroller, schedule, root } = view;
  useImperativeHandle(viewportRef, () => view);
  const setContainer = useCallback(
    (el: HTMLDivElement | null) => {
      container.current = el;
      if (mode !== "continuous") setScroller(el);
    },
    [mode, setScroller],
  );
  useLayoutEffect(() => {
    const el = root ?? container.current;
    if (!el) return;
    const resize = () => {
      const width = el.clientWidth,
        height = el.clientHeight;
      setViewport((v) =>
        v.width === width && v.height === height ? v : { width, height },
      );
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);
  const anchorRef = useRef(view.captureAnchor);
  anchorRef.current = view.captureAnchor;
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      anchorRef.current(e);
      if (e.deltaY < 0) useGalleryStore.getState().zoomIn();
      else if (e.deltaY > 0) useGalleryStore.getState().zoomOut();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    if (mode === "continuous") return;
    for (const i of [index - 1, index + 1])
      if (images[i]) {
        const image = new Image();
        image.src = imageUrl(images[i]);
      }
  }, [index, images, mode]);
  const gesture = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
    id: number;
  } | null>(null);
  const suppress = useRef(false),
    clickTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(
    () => () => clearTimeout(clickTimer.current),
    [mode, request?.epoch],
  );
  const canSwipe =
    mode !== "continuous" &&
    zoom <= 1 &&
    (!root || root.scrollWidth <= root.clientWidth + 1);
  useEffect(() => {
    const el = container.current;
    if (!el || !canSwipe) return;
    // 横向翻页归阅读器。原生纵向滚动与多指操作仍交给浏览器。
    const move = (event: TouchEvent) => {
      const start = gesture.current;
      if (!start || event.touches.length !== 1 || !event.cancelable) return;
      const dx = Math.abs(event.touches[0].clientX - start.x),
        dy = Math.abs(event.touches[0].clientY - start.y);
      if (dx > 5 && dx > dy * 1.2) event.preventDefault();
    };
    el.addEventListener("touchmove", move, { passive: false });
    return () => el.removeEventListener("touchmove", move);
  }, [canSwipe]);
  function pointerDown(e: PointerEvent<HTMLDivElement>) {
    if (
      (e.pointerType === "mouse" && e.button !== 0) ||
      (e.target as Element).closest("button")
    )
      return;
    suppress.current = false;
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      left: root?.scrollLeft ?? 0,
      top: root?.scrollTop ?? 0,
      moved: false,
      id: e.pointerId,
    };
  }
  function pointerMove(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || !root) return;
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) g.moved = true;
    if (g.moved && e.pointerType === "mouse") {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      root.scrollLeft = g.left - dx;
      root.scrollTop = g.top - dy;
    }
  }
  function finish(e: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    suppress.current = cancelled || g.moved || Math.abs(dx) + Math.abs(dy) > 5;
    if (
      !cancelled &&
      canSwipe &&
      e.pointerType !== "mouse" &&
      Math.abs(dx) >= 48 &&
      Math.abs(dx) > Math.abs(dy) * 1.2
    ) {
      e.preventDefault();
      const step = (direction === "rtl" ? dx > 0 : dx < 0) ? 1 : -1;
      // 等同一轮原生 touchend 送达原页，再卸载它；否则 Chromium 会吞掉下一次按钮点击。
      clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => onClickNavigate?.(step), 0);
    }
  }
  function row(indices: readonly number[]) {
    const layout = layoutPages({
      viewport,
      mode,
      fit,
      direction,
      rotation,
      zoom,
      gap: 4,
      pages: indices
        .filter((i) => !!images[i])
        .map((i) => {
          const id = images[i];
          const metadata = dimensions?.[id];
          return {
            index: i,
            fileId: id,
            source: validSize(metadata)
              ? metadata
              : (decoded[id]?.size ?? fallback),
          };
        }),
    });
    return (
      <div
        className="relative"
        data-image-index={indices[0]}
        style={{ width: layout.extent.width, height: layout.extent.height }}
      >
        {layout.boxes.map((box) => {
          const id = box.fileId,
            meta = dimensions?.[id],
            known = validSize(meta) ? meta : undefined;
          const original =
            mode !== "continuous" || (fit === "original" && !known);
          const url = original
            ? imageUrl(id)
            : previewUrl(id, previewWidth(box.imageWidth, known));
          return (
            <PageImage
              key={id}
              box={box}
              rotation={rotation}
              url={url}
              onDecode={(img) => {
                if (!known && img.naturalWidth > 0) {
                  const size = original
                    ? { width: img.naturalWidth, height: img.naturalHeight }
                    : {
                        width: fallback.width,
                        height:
                          (fallback.width * img.naturalHeight) /
                          img.naturalWidth,
                      };
                  setDecoded((old) => {
                    const prev = old[id];
                    if (
                      prev?.original ||
                      (prev?.size.height === size.height &&
                        prev.original === original)
                    )
                      return old;
                    return { ...old, [id]: { size, original } };
                  });
                }
                schedule();
              }}
            />
          );
        })}
      </div>
    );
  }
  return (
    <div
      ref={setContainer}
      data-image-gallery=""
      className="relative min-h-0 min-w-0 flex-1"
      style={{
        direction: "ltr",
        overflow: mode === "continuous" ? "hidden" : "auto",
        touchAction: canSwipe ? "pan-y" : "auto",
      }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onDoubleClick={(e) => {
        clearTimeout(clickTimer.current);
        if (!(e.target as Element).closest("[data-reader-page] img")) return;
        view.captureAnchor(e);
        const store = useGalleryStore.getState();
        if (zoom !== 1) store.zoomReset();
        else store.zoomIn();
      }}
      onClick={(e) => {
        if (suppress.current) {
          suppress.current = false;
          return;
        }
        if (e.detail > 1 || (e.target as Element).closest("button")) return;
        const rect = e.currentTarget.getBoundingClientRect(),
          fraction = (e.clientX - rect.left) / rect.width;
        const step = fraction < 0.35 ? -1 : fraction > 0.65 ? 1 : 0;
        if (step && zoom > 1) return;
        const go = () =>
          onClickNavigate?.(
            step === 0 ? 0 : ((direction === "rtl" ? -step : step) as -1 | 1),
          );
        clearTimeout(clickTimer.current);
        if (e.detail === 0) go();
        else clickTimer.current = setTimeout(go, 280);
      }}
    >
      {mode === "continuous"
        ? validSize(viewport) && (
            <Virtuoso
              ref={virtuoso}
              data={images}
              context={{ footer: rest.footer }}
              components={continuousParts}
              initialTopMostItemIndex={Math.max(0, request?.index ?? index)}
              totalListHeightChanged={schedule}
              style={{ height: "100%", direction: "ltr" }}
              scrollerRef={setScroller}
              rangeChanged={schedule}
              overscan={500}
              minOverscanItemCount={{ top: 1, bottom: 1 }}
              computeItemKey={(_, id) => id}
              itemContent={(i) => row([i])}
            />
          )
        : row(
            mode === "double"
              ? spreadAt(index, images.length, coverOffset)
              : [index],
          )}
    </div>
  );
}
