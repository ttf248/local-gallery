import { create } from 'zustand'
import { sessionStorage } from '../utils/storage'

/** 阅读模式：单页翻页 / 连续滚动 / 双页对开 */
export type ReaderMode = 'single' | 'continuous' | 'double'
/** 图片适配：contain（适应）/ width（按宽）/ height（按高）/ original（原始） */
export type FitMode = 'fit' | 'width' | 'height' | 'original'
/** 阅读方向：ltr（左→右）/ rtl（右→左，原版日漫） */
export type ReadDirection = 'ltr' | 'rtl'

// 查看器状态（仅 sessionStorage 持久化，关闭页面即重置）。
export interface ViewerState {
  // 当前图片索引（-1 = 未选择）
  index: number
  zoom: number // 1.0 = 100%
  rotation: number // 0/90/180/270
  fullscreen: boolean
  slideshow: boolean
  slideshowInterval: number // ms
  mode: ReaderMode
  fit: FitMode
  direction: ReadDirection

  setIndex: (i: number) => void
  setZoom: (z: number) => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  rotate: (deg?: number) => void
  toggleFullscreen: () => void
  toggleSlideshow: () => void
  setSlideshowInterval: (ms: number) => void
  setMode: (m: ReaderMode) => void
  setFit: (f: FitMode) => void
  setDirection: (d: ReadDirection) => void
  cycleFit: () => void
}

const FIT_CYCLE: FitMode[] = ['fit', 'width', 'height', 'original']

export const useViewerStore = create<ViewerState>()(
  sessionStorage(
    (set, get) => ({
      index: -1,
      zoom: 1,
      rotation: 0,
      fullscreen: false,
      slideshow: false,
      slideshowInterval: 3000,
      mode: 'single',
      fit: 'fit',
      direction: 'rtl',

      setIndex: (i) => set({ index: i }),
      setZoom: (z) => set({ zoom: clamp(z, 0.1, 5) }),
      zoomIn: () => set({ zoom: clamp(get().zoom * 1.2, 0.1, 5) }),
      zoomOut: () => set({ zoom: clamp(get().zoom / 1.2, 0.1, 5) }),
      zoomReset: () => set({ zoom: 1 }),
      rotate: (deg = 90) =>
        set({ rotation: ((get().rotation + deg) % 360 + 360) % 360 }),
      toggleFullscreen: () => set({ fullscreen: !get().fullscreen }),
      toggleSlideshow: () => set({ slideshow: !get().slideshow }),
      setSlideshowInterval: (ms) => set({ slideshowInterval: ms }),
      setMode: (m) => {
        // 双页模式下，索引对齐到偶数（左页），单页模式恢复奇数对齐
        if (m === 'double') {
          const i = get().index
          if (i > 0 && i % 2 === 1) set({ mode: m, index: i - 1 })
          else set({ mode: m })
        } else {
          set({ mode: m })
        }
      },
      setFit: (f) => set({ fit: f }),
      setDirection: (d) => set({ direction: d }),
      cycleFit: () => {
        const cur = get().fit
        const idx = FIT_CYCLE.indexOf(cur)
        set({ fit: FIT_CYCLE[(idx + 1) % FIT_CYCLE.length] })
      },
    }),
    'comic-reader-viewer',
  ),
)

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}
