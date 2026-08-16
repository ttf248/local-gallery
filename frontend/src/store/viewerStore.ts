import { create } from 'zustand'
import { sessionStorage } from '../utils/storage'

/** 显示模式：单张 / 连续滚动 / 双张并排 */
export type ReaderMode = 'single' | 'continuous' | 'double'
/** 图片适配：适应 / 按宽 / 按高 / 原始 */
export type FitMode = 'fit' | 'width' | 'height' | 'original'
/** 翻页方向：ltr（左→右）/ rtl（右→左） */
export type ReadDirection = 'ltr' | 'rtl'

// 查看器状态（仅 sessionStorage 持久化，关闭页面即重置）。
export interface ViewerState {
  // 当前图片索引（-1 = 未选择）
  index: number
  zoom: number // 1.0 = 100%
  rotation: number // 0/90/180/270
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
  /** 重置 zoom + rotation 到默认；切换 album 时用，避免上一个 album 的状态延续 */
  resetView: () => void
  /**
   * 全屏切换：直接调浏览器 Fullscreen API，不写 store 状态。
   * 不在 store 里 mirror 一份 `fullscreen: boolean`：浏览器 fullscreenElement
   * 才是真相源，store 里再写一个会被外部状态变化（F11 / 退出键）打脸。
   */
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
      resetView: () => set({ zoom: 1, rotation: 0 }),
      toggleFullscreen: () => {
        // 真正调浏览器 API；store 状态跟实际 fullscreenElement 同步
        if (typeof document === 'undefined') return
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {})
        } else {
          document.documentElement.requestFullscreen().catch(() => {})
        }
      },
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
