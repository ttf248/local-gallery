import { useEffect, useMemo, useRef, useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import { imageUrl } from '../../api/images'

interface Props {
  images: string[]
}

type Aspect =
  | { mode: 'fit' } // contain
  | { mode: 'width' } // 100% 宽，自适应高
  | { mode: 'height' } // 100vh 高，水平居中
  | { mode: 'original' } // 自然尺寸

// 图片查看器：
// - 三种阅读模式：单页 / 连续滚动 / 双页对开
// - 四种适配：contain / 按宽 / 按高 / 原始
// - 双页模式下支持 LTR / RTL（原版日漫从右往左）
// - 缩放 / 旋转 / 拖拽 / 预加载 ±2
export default function ImageViewer({ images }: Props) {
  const index = useViewerStore((s) => s.index)
  const zoom = useViewerStore((s) => s.zoom)
  const rotation = useViewerStore((s) => s.rotation)
  const mode = useViewerStore((s) => s.mode)
  const fit = useViewerStore((s) => s.fit)
  const direction = useViewerStore((s) => s.direction)

  const containerRef = useRef<HTMLDivElement>(null)
  const singleRef = useRef<HTMLImageElement>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [imgKey, setImgKey] = useState(0)
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  // 预加载前后各 2 张
  useEffect(() => {
    const ranges = [index - 2, index - 1, index + 1, index + 2]
    for (const i of ranges) {
      const p = images[i]
      if (!p) continue
      const img = new Image()
      img.src = imageUrl(p)
    }
  }, [index, images])

  // 切页 / 切模式时复位 transform & 容器滚动
  useEffect(() => {
    setPan({ x: 0, y: 0 })
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
      containerRef.current.scrollLeft = 0
    }
    setImgKey((k) => k + 1)
  }, [index, mode])

  // 滚轮缩放（Ctrl/Cmd + wheel）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const dir = e.deltaY > 0 ? -1 : 1
      const store = useViewerStore.getState()
      if (dir > 0) store.zoomIn()
      else store.zoomOut()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 拖拽平移
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const dx = e.clientX - dragRef.current.x
      const dy = e.clientY - dragRef.current.y
      setPan({ x: dragRef.current.px + dx, y: dragRef.current.py + dy })
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const onMouseDown = (e: React.MouseEvent) => {
    if (mode !== 'single') return
    if (zoom <= 1) return
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
  }

  // 单页模式下，索引到当前页（双页模式 index 指向左页）
  const current = images[index]

  // 解析 fit → 样式 / 容器类
  const aspect: Aspect = useMemo(() => ({ mode: fit }), [fit])
  const isSingle = mode === 'single'
  const isContinuous = mode === 'continuous'

  // 容器公共类
  // 单页模式：容器自己滚动 + flex 居中
  // 连续 / 双页模式：容器滚动（避免上层 / 下层元素双层滚动）
  const containerCls = isSingle
    ? 'relative flex-1 overflow-auto bg-bg-subtle flex items-center justify-center min-h-0'
    : 'relative flex-1 overflow-auto bg-bg-subtle min-h-0'

  // 单张图片的尺寸 / object-fit 规则
  function imgStyleFor(zoomOverride?: number): React.CSSProperties {
    const z = zoomOverride ?? zoom
    const transform = isSingle
      ? `translate(${pan.x}px, ${pan.y}px) scale(${z}) rotate(${rotation}deg)`
      : `rotate(${rotation}deg)`
    const base: React.CSSProperties = {
      transform,
      transformOrigin: 'center',
      transition: dragRef.current ? 'none' : 'transform 200ms var(--ease-out)',
    }
    if (aspect.mode === 'fit') {
      return { ...base, maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' as const }
    }
    if (aspect.mode === 'width') {
      return { ...base, width: '100%', height: 'auto' }
    }
    if (aspect.mode === 'height') {
      return { ...base, height: '100vh', width: 'auto', maxWidth: '100%' }
    }
    return { ...base, width: 'auto', height: 'auto' }
  }

  function imgClassFor(): string {
    const baseCls = 'select-none scale-fade'
    if (isSingle) {
      return `${baseCls} ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`
    }
    return baseCls
  }

  if (isSingle) {
    return (
      <div
        ref={containerRef}
        className={containerCls}
        onContextMenu={(e) => e.preventDefault()}
      >
        {current ? (
          <img
            key={imgKey}
            ref={singleRef}
            src={imageUrl(current)}
            alt={`page ${index + 1}`}
            draggable={false}
            onMouseDown={onMouseDown}
            onDoubleClick={() => {
              const store = useViewerStore.getState()
              if (store.zoom > 1) {
                store.zoomReset()
                setPan({ x: 0, y: 0 })
              } else {
                store.setZoom(1.6)
              }
            }}
            className={imgClassFor()}
            style={imgStyleFor()}
          />
        ) : (
          <div className="text-fg-muted">未选择图片</div>
        )}
      </div>
    )
  }

  if (isContinuous) {
    // 连续滚动模式：每张图按比例显示，超大图使用 fit 模式自适应。
    // 关键：每张图使用 block 元素 + 最大宽度 100%，让浏览器自然堆叠可滚动。
    return (
      <div
        ref={containerRef}
        className={containerCls}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center gap-2 py-4">
          {images.map((src, i) => (
            <ContinuousImage
              key={i}
              src={src}
              index={i}
              aspect={aspect}
              nearIndex={Math.abs(i - index) <= 2}
              isRotated={rotation !== 0}
            />
          ))}
        </div>
      </div>
    )
  }

  // double mode
  return (
    <div
      ref={containerRef}
      className={containerCls}
      onContextMenu={(e) => e.preventDefault()}
    >
      <DoublePage
        images={images}
        index={index}
        aspect={aspect}
        direction={direction}
        imgKey={imgKey}
      />
    </div>
  )
}

interface DoubleProps {
  images: string[]
  index: number
  aspect: Aspect
  direction: 'ltr' | 'rtl'
  imgKey: number
}

// 双页模式：每两页为一对，左页 = index，右页 = index+1。
// RTL（原版日漫）右页在前，左页在后。
function DoublePage({ images, index, aspect, direction, imgKey }: DoubleProps) {
  const left = images[index]
  const right = images[index + 1]

  // RTL 把 (left, right) 反过来渲染
  const order: Array<'left' | 'right'> = direction === 'rtl' ? ['right', 'left'] : ['left', 'right']
  const pages: Array<{ key: 'left' | 'right'; src: string | undefined }> = [
    { key: 'left', src: left },
    { key: 'right', src: right },
  ]
  const ordered = order.map((k) => pages.find((p) => p.key === k)!).filter(Boolean)

  function pageClass() {
    if (aspect.mode === 'fit') {
      return 'max-w-full max-h-full object-contain'
    }
    if (aspect.mode === 'width') {
      return 'w-full h-auto'
    }
    if (aspect.mode === 'height') {
      return 'h-screen w-auto max-w-full'
    }
    return 'w-auto h-auto'
  }

  return (
    <div
      key={imgKey}
      className="flex flex-row items-center justify-center w-full h-full gap-1 p-2"
    >
      {ordered.map((p, i) => (
        <div key={p.key + i} className="flex-1 min-w-0 flex justify-center">
          {p.src ? (
            <img
              src={imageUrl(p.src)}
              alt={`page ${p.key}`}
              draggable={false}
              loading="eager"
              className={`select-none ${pageClass()}`}
            />
          ) : (
            <div className="text-fg-subtle text-xs">（空页）</div>
          )}
        </div>
      ))}
    </div>
  )
}

// 连续模式下的单张图：根据 fit 模式选择样式。
// 关键：使用 maxWidth: 100% + block 布局，让图片按比例缩放并触发容器纵向滚动。
interface ContinuousImageProps {
  src: string
  index: number
  aspect: Aspect
  nearIndex: boolean
  isRotated: boolean
}

function ContinuousImage({ src, index, aspect, nearIndex, isRotated }: ContinuousImageProps) {
  const baseStyle: React.CSSProperties = {
    display: 'block',
    maxWidth: '100%',
    height: 'auto',
  }
  let style: React.CSSProperties
  if (aspect.mode === 'fit') {
    // 适应：宽度 100%，高度自适应（按原比例），浏览器自动堆叠可滚动
    style = { ...baseStyle, width: '100%', height: 'auto' }
  } else if (aspect.mode === 'width') {
    // 按宽：同上
    style = { ...baseStyle, width: '100%', height: 'auto' }
  } else if (aspect.mode === 'height') {
    // 按高：每张图占满视口高度（适合长条图）→ 高度 100vh，宽度按比例
    style = { ...baseStyle, height: '100vh', width: 'auto', maxHeight: '100vh' }
  } else {
    // 原始：自然尺寸，超过容器宽度时缩小
    style = { ...baseStyle, width: 'auto', height: 'auto', maxWidth: '100%' }
  }

  if (isRotated) {
    style = { ...style, transform: 'rotate(90deg)', transformOrigin: 'center' }
  }

  return (
    <div className="w-full flex justify-center">
      <img
        src={imageUrl(src)}
        alt={`page ${index + 1}`}
        draggable={false}
        loading={nearIndex ? 'eager' : 'lazy'}
        decoding={nearIndex ? 'sync' : 'async'}
        className="select-none scale-fade"
        style={style}
      />
    </div>
  )
}
