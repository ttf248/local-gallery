import { create } from 'zustand'
import { sessionStorage } from '../utils/storage'

// 查看器状态（仅 sessionStorage 持久化，关闭页面即重置）。
export interface ViewerState {
  // 当前图片索引（-1 = 未选择）
  index: number
  zoom: number // 1.0 = 100%
  rotation: number // 0/90/180/270
  fullscreen: boolean
  slideshow: boolean
  slideshowInterval: number // ms

  setIndex: (i: number) => void
  setZoom: (z: number) => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  rotate: (deg?: number) => void
  toggleFullscreen: () => void
  toggleSlideshow: () => void
  setSlideshowInterval: (ms: number) => void
}

export const useViewerStore = create<ViewerState>()(
  sessionStorage(
    (set, get) => ({
      index: -1,
      zoom: 1,
      rotation: 0,
      fullscreen: false,
      slideshow: false,
      slideshowInterval: 3000,

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
    }),
    'comic-reader-viewer',
  ),
)

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}
