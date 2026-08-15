import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useViewerStore } from './viewerStore'

// viewerStore 用 sessionStorage 持久化，测试间要清掉
beforeEach(() => {
  sessionStorage.clear()
  // 重置 store 到初始 state：直接 set 回去
  useViewerStore.setState({
    index: -1,
    zoom: 1,
    rotation: 0,
    fullscreen: false,
    slideshow: false,
    slideshowInterval: 3000,
    mode: 'single',
    fit: 'fit',
    direction: 'rtl',
  })
})

afterEach(() => {
  sessionStorage.clear()
})

describe('viewerStore / zoom', () => {
  it('zoomIn 把 zoom 乘 1.2，clamp 到 [0.1, 5]', () => {
    useViewerStore.getState().zoomIn()
    expect(useViewerStore.getState().zoom).toBeCloseTo(1.2, 5)
    useViewerStore.getState().zoomIn()
    expect(useViewerStore.getState().zoom).toBeCloseTo(1.44, 5)
  })

  it('zoomOut 把 zoom 除以 1.2', () => {
    useViewerStore.getState().zoomOut()
    expect(useViewerStore.getState().zoom).toBeCloseTo(1 / 1.2, 5)
  })

  it('zoomReset 回到 1', () => {
    useViewerStore.getState().zoomIn()
    useViewerStore.getState().zoomIn()
    useViewerStore.getState().zoomReset()
    expect(useViewerStore.getState().zoom).toBe(1)
  })

  it('setZoom clamp 到 [0.1, 5]', () => {
    useViewerStore.getState().setZoom(10)
    expect(useViewerStore.getState().zoom).toBe(5)
    useViewerStore.getState().setZoom(0.001)
    expect(useViewerStore.getState().zoom).toBe(0.1)
  })
})

describe('viewerStore / rotation', () => {
  it('rotate(90) 把 0 → 90 → 180 → 270 → 0', () => {
    const r = () => useViewerStore.getState().rotation
    expect(r()).toBe(0)
    useViewerStore.getState().rotate(90)
    expect(r()).toBe(90)
    useViewerStore.getState().rotate(90)
    expect(r()).toBe(180)
    useViewerStore.getState().rotate(90)
    expect(r()).toBe(270)
    useViewerStore.getState().rotate(90)
    expect(r()).toBe(0)
  })

  it('rotate(-90) 也走模 360', () => {
    useViewerStore.getState().rotate(-90)
    expect(useViewerStore.getState().rotation).toBe(270)
  })
})

describe('viewerStore / setMode', () => {
  it('切到 double：index 对齐到偶数', () => {
    useViewerStore.setState({ index: 5 })
    useViewerStore.getState().setMode('double')
    expect(useViewerStore.getState().index).toBe(4)
    expect(useViewerStore.getState().mode).toBe('double')
  })

  it('切到 double：index=0 不动', () => {
    useViewerStore.setState({ index: 0 })
    useViewerStore.getState().setMode('double')
    expect(useViewerStore.getState().index).toBe(0)
  })

  it('从 double 切回 single 不动 index', () => {
    useViewerStore.setState({ mode: 'double', index: 6 })
    useViewerStore.getState().setMode('single')
    expect(useViewerStore.getState().index).toBe(6)
  })
})

describe('viewerStore / cycleFit', () => {
  it('fit → width → height → original → fit', () => {
    const f = () => useViewerStore.getState().fit
    expect(f()).toBe('fit')
    useViewerStore.getState().cycleFit()
    expect(f()).toBe('width')
    useViewerStore.getState().cycleFit()
    expect(f()).toBe('height')
    useViewerStore.getState().cycleFit()
    expect(f()).toBe('original')
    useViewerStore.getState().cycleFit()
    expect(f()).toBe('fit')
  })
})
