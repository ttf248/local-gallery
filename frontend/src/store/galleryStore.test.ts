import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useGalleryStore } from './galleryStore'

// galleryStore 用 localStorage 持久化（仅 mode/fit/direction 三项偏好），
// 测试间要清掉，避免上一个 case 的偏好串到这个 case
beforeEach(() => {
  localStorage.clear()
  // 重置 store 到初始 state：直接 set 回去
  useGalleryStore.setState({
    index: -1,
    zoom: 1,
    rotation: 0,
    slideshow: false,
    slideshowInterval: 3000,
    mode: 'single',
    fit: 'fit',
    direction: 'rtl',
  })
})

afterEach(() => {
  localStorage.clear()
})

describe('galleryStore / zoom', () => {
  it('zoomIn 把 zoom 乘 1.2，clamp 到 [0.1, 5]', () => {
    useGalleryStore.getState().zoomIn()
    expect(useGalleryStore.getState().zoom).toBeCloseTo(1.2, 5)
    useGalleryStore.getState().zoomIn()
    expect(useGalleryStore.getState().zoom).toBeCloseTo(1.44, 5)
  })

  it('zoomOut 把 zoom 除以 1.2', () => {
    useGalleryStore.getState().zoomOut()
    expect(useGalleryStore.getState().zoom).toBeCloseTo(1 / 1.2, 5)
  })

  it('zoomReset 回到 1', () => {
    useGalleryStore.getState().zoomIn()
    useGalleryStore.getState().zoomIn()
    useGalleryStore.getState().zoomReset()
    expect(useGalleryStore.getState().zoom).toBe(1)
  })

  it('setZoom clamp 到 [0.1, 5]', () => {
    useGalleryStore.getState().setZoom(10)
    expect(useGalleryStore.getState().zoom).toBe(5)
    useGalleryStore.getState().setZoom(0.001)
    expect(useGalleryStore.getState().zoom).toBe(0.1)
  })
})

describe('galleryStore / rotation', () => {
  it('rotate(90) 把 0 → 90 → 180 → 270 → 0', () => {
    const r = () => useGalleryStore.getState().rotation
    expect(r()).toBe(0)
    useGalleryStore.getState().rotate(90)
    expect(r()).toBe(90)
    useGalleryStore.getState().rotate(90)
    expect(r()).toBe(180)
    useGalleryStore.getState().rotate(90)
    expect(r()).toBe(270)
    useGalleryStore.getState().rotate(90)
    expect(r()).toBe(0)
  })

  it('rotate(-90) 也走模 360', () => {
    useGalleryStore.getState().rotate(-90)
    expect(useGalleryStore.getState().rotation).toBe(270)
  })
})

describe('galleryStore / setMode', () => {
  it('切到 double：index 对齐到偶数', () => {
    useGalleryStore.setState({ index: 5 })
    useGalleryStore.getState().setMode('double')
    expect(useGalleryStore.getState().index).toBe(4)
    expect(useGalleryStore.getState().mode).toBe('double')
  })

  it('切到 double：index=0 不动', () => {
    useGalleryStore.setState({ index: 0 })
    useGalleryStore.getState().setMode('double')
    expect(useGalleryStore.getState().index).toBe(0)
  })

  it('从 double 切回 single 不动 index', () => {
    useGalleryStore.setState({ mode: 'double', index: 6 })
    useGalleryStore.getState().setMode('single')
    expect(useGalleryStore.getState().index).toBe(6)
  })
})

describe('galleryStore / cycleFit', () => {
  it('fit → width → height → original → fit', () => {
    const f = () => useGalleryStore.getState().fit
    expect(f()).toBe('fit')
    useGalleryStore.getState().cycleFit()
    expect(f()).toBe('width')
    useGalleryStore.getState().cycleFit()
    expect(f()).toBe('height')
    useGalleryStore.getState().cycleFit()
    expect(f()).toBe('original')
    useGalleryStore.getState().cycleFit()
    expect(f()).toBe('fit')
  })
})
