import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import type { ReaderMode } from "../../store/galleryStore";
import { clampPage } from "./readerLayout";

export type JumpSource =
  "restore" | "link" | "slider" | "overview" | "key" | "menu";
export interface ReaderJump {
  epoch: number;
  index: number;
  source: JumpSource;
}
export interface ReaderAnchor {
  albumId: string;
  fileId: string;
  index: number;
  u: number;
  v: number;
  viewportU: number;
  viewportV: number;
}
export interface ReaderObservation {
  albumId: string;
  epoch: number;
  first: number;
  last: number;
  anchor: ReaderAnchor;
  atTop: boolean;
  atBottom: boolean;
}
export interface ReaderViewportHandle {
  jumpTo(index: number, source: JumpSource): void;
  scrollScreen(direction: -1 | 1): boolean;
  captureAnchor(at?: { clientX: number; clientY: number }): ReaderAnchor | null;
  restoreAnchor(anchor: ReaderAnchor, epoch: number): void;
}
export interface ReaderCommandTarget {
  albumId: string;
  fileId: string;
  index: number;
}

type Point = { x: number; y: number };
function rotateUnit({ x, y }: Point, degrees: number): Point {
  switch ((degrees + 360) % 360) {
    case 90:
      return { x: 1 - y, y: x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: y, y: 1 - x };
    default:
      return { x, y };
  }
}
const unit = (n: number) => Math.max(0, Math.min(1, n));

export function visiblePages(root: HTMLElement) {
  const viewport = root.getBoundingClientRect();
  const pages = Array.from(
    root.querySelectorAll<HTMLElement>("[data-reader-page]"),
  )
    .map((node) => ({
      node,
      index: Number(node.dataset.readerPage),
      rect: node.getBoundingClientRect(),
    }))
    .filter(({ rect, node }) => {
      const img =
        node instanceof HTMLImageElement ? node : node.querySelector("img");
      return (
        img?.complete &&
        img.naturalWidth > 0 &&
        Math.min(viewport.right, rect.right) -
          Math.max(viewport.left, rect.left) >
          0.5 &&
        Math.min(viewport.bottom, rect.bottom) -
          Math.max(viewport.top, rect.top) >
          0.5
      );
    })
    .sort((a, b) => a.index - b.index);
  return { viewport, pages };
}

interface Options {
  albumId: string;
  images: string[];
  index: number;
  mode: ReaderMode;
  rotation: number;
  layoutKey: string;
  request: ReaderJump;
  virtuoso: RefObject<VirtuosoHandle>;
  onInvalidate?: () => void;
  onObserve?: (value: ReaderObservation) => void;
}

export function useReaderViewport(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const frame = useRef(0);
  const anchor = useRef<ReaderAnchor | null>(null);
  const pending = useRef<{
    index: number;
    anchor: ReaderAnchor | null;
    sought: boolean;
    stable?: boolean;
  } | null>(null);
  const measure = useRef<() => void>(() => {});
  const schedule = useCallback(() => {
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        measure.current();
      });
  }, []);
  function readAnchor(at?: { clientX: number; clientY: number }) {
    if (!root) return null;
    const { viewport, pages } = visiblePages(root);
    const { albumId, images, index, rotation } = latest.current;
    const cx = at?.clientX ?? viewport.left + viewport.width / 2,
      cy = at?.clientY ?? viewport.top + viewport.height / 2;
    const page =
      (at &&
        pages.find(
          ({ rect }) =>
            cx >= rect.left &&
            cx < rect.right &&
            cy >= rect.top &&
            cy < rect.bottom,
        )) ||
      pages.find((p) => p.index === index) ||
      pages[0];
    if (!page) return null;
    const { rect } = page;
    const x = Math.max(
      viewport.left,
      Math.min(viewport.right, Math.max(rect.left, Math.min(rect.right, cx))),
    );
    const y = Math.max(
      viewport.top,
      Math.min(viewport.bottom, Math.max(rect.top, Math.min(rect.bottom, cy))),
    );
    const source = rotateUnit(
      {
        x: unit((x - rect.left) / rect.width),
        y: unit((y - rect.top) / rect.height),
      },
      -rotation,
    );
    return {
      albumId,
      fileId: images[page.index],
      index: page.index,
      u: source.x,
      v: source.y,
      viewportU: unit((x - viewport.left) / viewport.width),
      viewportV: unit((y - viewport.top) / viewport.height),
    };
  }
  const captureAnchor = (at?: { clientX: number; clientY: number }) =>
    (anchor.current = readAnchor(at));
  const restoreAnchor = (saved: ReaderAnchor, epoch: number) => {
    if (saved.albumId !== options.albumId || epoch !== options.request.epoch)
      return;
    const i = options.images.indexOf(saved.fileId);
    pending.current = {
      index: i < 0 ? clampPage(saved.index, options.images.length) : i,
      anchor: saved,
      sought: false,
    };
    schedule();
  };
  measure.current = () => {
    if (!root || !root.isConnected || !root.clientWidth || !root.clientHeight)
      return;
    const { images, mode, request, rotation, albumId, virtuoso, onObserve } =
      latest.current;
    const target = pending.current;
    if (target) {
      const n = root.querySelector<HTMLElement>(
        `[data-reader-page="${target.index}"]`,
      );
      if (!n && mode === "continuous") {
        if (!target.sought) {
          virtuoso.current?.scrollToIndex({
            index: target.index,
            align: "start",
          });
          target.sought = true;
        }
        return;
      }
      if (!n) return;
      const rect = n.getBoundingClientRect(),
        v = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      let dx = 0,
        dy = 0;
      if (target.anchor) {
        const a = target.anchor,
          p = rotateUnit({ x: a.u, y: a.v }, rotation);
        dx = rect.left + p.x * rect.width - v.left - a.viewportU * v.width;
        dy = rect.top + p.y * rect.height - v.top - a.viewportV * v.height;
      } else {
        dy = mode === "continuous" ? rect.top - v.top : -root.scrollTop;
        if (
          rect.left >= v.right ||
          rect.right <= v.left ||
          rect.width > v.width
        )
          dx = rect.left - v.left;
        else if (mode !== "double") dx = -root.scrollLeft;
      }
      const beforeX = root.scrollLeft,
        beforeY = root.scrollTop;
      if (Math.abs(dx) > 0.75) root.scrollLeft += dx;
      if (Math.abs(dy) > 0.75) root.scrollTop += dy;
      if (root.scrollLeft !== beforeX || root.scrollTop !== beforeY) {
        schedule();
        return;
      }
    }
    const { pages } = visiblePages(root);
    if (
      !pages.length ||
      (target && !pages.some((p) => p.index === target.index))
    )
      return;
    if (target && !target.stable) {
      target.stable = true;
      schedule();
      return;
    }
    pending.current = null;
    const saved = readAnchor();
    if (!saved) return;
    anchor.current = saved;
    const first = pages[0].index,
      last = pages[pages.length - 1].index;
    onObserve?.({
      albumId,
      epoch: request.epoch,
      first,
      last,
      anchor: saved,
      atTop: first === 0 && root.scrollTop < 1,
      atBottom:
        last === images.length - 1 &&
        root.scrollHeight - root.clientHeight - root.scrollTop < 1,
    });
    // 逻辑目标由控制器保留。自然滚动离开目标后才采用新的首页。
  };
  const previous = useRef<{
    epoch: number;
    key: string;
    root: HTMLElement | null;
  } | null>(null);
  useLayoutEffect(() => {
    const prev = previous.current;
    const fresh = !prev || prev.epoch !== options.request.epoch;
    if (fresh || prev.key !== options.layoutKey || prev.root !== root) {
      latest.current.onInvalidate?.();
      const saved = fresh ? null : anchor.current;
      pending.current = {
        index: clampPage(
          fresh
            ? options.request.index
            : (saved?.index ?? pending.current?.index ?? latest.current.index),
          latest.current.images.length,
        ),
        anchor: saved,
        sought: false,
      };
      previous.current = {
        epoch: options.request.epoch,
        key: options.layoutKey,
        root,
      };
    }
    schedule();
  }, [
    options.request.epoch,
    options.request.index,
    options.layoutKey,
    root,
    schedule,
  ]);
  useLayoutEffect(() => {
    if (!root) return;
    root.addEventListener("scroll", schedule, { passive: true });
    root.addEventListener("load", schedule, true);
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    ro?.observe(root);
    schedule();
    return () => {
      root.removeEventListener("scroll", schedule);
      root.removeEventListener("load", schedule, true);
      ro?.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [root, schedule]);
  return {
    root,
    setScroller: useCallback(
      (el: HTMLElement | Window | null) =>
        setRoot(el instanceof HTMLElement ? el : null),
      [],
    ),
    schedule,
    captureAnchor,
    restoreAnchor,
    jumpTo(index: number) {
      pending.current = { index, anchor: null, sought: false };
      schedule();
    },
    scrollScreen(dir: -1 | 1) {
      if (!root) return false;
      const top = root.scrollTop,
        next = Math.max(
          0,
          Math.min(
            root.scrollHeight - root.clientHeight,
            top + dir * root.clientHeight * 0.9,
          ),
        );
      if (Math.abs(next - top) < 1) return false;
      pending.current = null;
      root.scrollTo({ top: next, behavior: "instant" });
      schedule();
      return true;
    },
  };
}
