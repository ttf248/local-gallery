import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 显示模式：单张 / 连续滚动 / 双张并排 */
export type ReaderMode = "single" | "continuous" | "double";
/** 图片适配：适应 / 按宽 / 按高 / 原始 */
export type FitMode = "fit" | "width" | "height" | "original";
/** 翻页方向：ltr（左→右）/ rtl（右→左） */
export type ReadDirection = "ltr" | "rtl";

// 画廊状态：
// - 用户偏好（mode/fit/direction）→ localStorage 跨会话保留,关 tab 再开还是上次的选择
// - 临时状态（index/zoom/rotation/slideshow/slideshowInterval）→ 不持久化,
//   切换 album 时 resetView 会重置 zoom/rotation,index 由 URL 决定
//
// 注:全屏 toggle 以前在 store 里(action 不写 state,只调浏览器 API),
// 实际上是死代码。已迁到 utils/fullscreen.ts,调用方直接用。
export interface GalleryState {
  // 当前图片索引（-1 = 未选择）
  index: number;
  zoom: number; // 1.0 = 100%
  rotation: 0 | 90 | 180 | 270; // 0/90/180/270
  slideshow: boolean;
  slideshowInterval: number; // ms
  mode: ReaderMode;
  fit: FitMode;
  direction: ReadDirection;

  setIndex: (i: number) => void;
  setZoom: (z: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  rotate: (deg?: number) => void;
  /** 重置 zoom + rotation 到默认；切换 album 时用，避免上一个 album 的状态延续 */
  resetView: () => void;
  toggleSlideshow: () => void;
  setSlideshowInterval: (ms: number) => void;
  setMode: (m: ReaderMode) => void;
  setFit: (f: FitMode) => void;
  setDirection: (d: ReadDirection) => void;
  cycleFit: () => void;
}

const FIT_CYCLE: FitMode[] = ["fit", "width", "height", "original"];

export const useGalleryStore = create<GalleryState>()(
  persist(
    (set, get) => ({
      index: -1,
      zoom: 1,
      rotation: 0,
      slideshow: false,
      slideshowInterval: 3000,
      mode: "single",
      fit: "fit",
      direction: "rtl",

      setIndex: (i) => set({ index: i }),
      setZoom: (z) => set({ zoom: clamp(z, 0.1, 5) }),
      zoomIn: () => set({ zoom: clamp(get().zoom * 1.2, 0.1, 5) }),
      zoomOut: () => set({ zoom: clamp(get().zoom / 1.2, 0.1, 5) }),
      zoomReset: () => set({ zoom: 1 }),
      rotate: (deg = 90) =>
        set({
          rotation: ([0, 90, 180, 270] as const)[
            ((Math.round(
              (get().rotation + (Number.isFinite(deg) ? deg : 0)) / 90,
            ) %
              4) +
              4) %
              4
          ],
        }),
      resetView: () => set({ zoom: 1, rotation: 0 }),
      toggleSlideshow: () => set({ slideshow: !get().slideshow }),
      setSlideshowInterval: (ms) => set({ slideshowInterval: ms }),
      setMode: (mode) => set({ mode }),
      setFit: (f) => set({ fit: f }),
      setDirection: (d) => set({ direction: d }),
      cycleFit: () => {
        const cur = get().fit;
        const idx = FIT_CYCLE.indexOf(cur);
        set({ fit: FIT_CYCLE[(idx + 1) % FIT_CYCLE.length] });
      },
    }),
    {
      name: "local-gallery",
      merge: (persisted, current) => {
        const preferences =
          persisted && typeof persisted === "object" ? persisted : {};
        return {
          ...current,
          mode:
            "mode" in preferences &&
            (preferences.mode === "continuous" || preferences.mode === "double")
              ? preferences.mode
              : "single",
          fit:
            "fit" in preferences &&
            (preferences.fit === "width" ||
              preferences.fit === "height" ||
              preferences.fit === "original")
              ? preferences.fit
              : "fit",
          direction:
            "direction" in preferences && preferences.direction === "ltr"
              ? "ltr"
              : "rtl",
        };
      },
      // 只持久化用户偏好(模式/适配/方向),其余临时态(index/zoom/rotation/slideshow)
      // 不进 localStorage,避免换 album 时被旧状态污染,也避免 slideshow 之类跨会话遗留
      partialize: (s) => ({
        mode: s.mode,
        fit: s.fit,
        direction: s.direction,
      }),
    },
  ),
);

function clamp(v: number, lo: number, hi: number) {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 1;
}
