import { useEffect, useMemo, useRef, useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import { imageUrl } from '../../api/images'

interface Props {
  images: string[]
  /** 点击图片时触发：根据 clickX 在容器宽度的左/中/右决定动作。父组件传入 prev/next 即可。 */
  onClickNavigate?: (dir: -1 | 0 | 1) => void
}

type Aspect =
  | { mode: 'fit' } // contain
  | { mode: 'width' } // 100% 宽，自适应高
  | { mode: 'height' } // 100vh 高，水平居中
  | { mode: 'original' } // 自然尺寸

// 图片查看器：
// - 三种显示模式：单张 / 连续滚动 / 双张并排
// - 四种适配：适应 / 按宽 / 按高 / 原始
// - 双张并排模式下支持 LTR / RTL（右→左：从右开始翻页）
// - 缩放 / 旋转 / 拖拽 / 预加载 ±2
// - 点击翻页：左半区上一页 / 右半区下一页 / 中段 30% 不响应避免误触
export default function ImageViewer({ images, onClickNavigate }: Props) {
  const index = useViewerStore((s) => s.index)
  const zoom = useViewerStore((s) => s.zoom)
  const rotation = useViewerStore((s) => s.rotation)
  const mode = useViewerStore((s) => s.mode)
  const fit = useViewerStore((s) => s.fit)
  const direction = useViewerStore((s) => s.direction)

  const containerRef = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [imgKey, setImgKey] = useState(0)
  const dragRef = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null)

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

  // 滚轮缩放：所有模式统一为 Ctrl/Cmd + wheel 才触发。
  // 普通 wheel 留给浏览器原生滚动（单/双页溢出滚动、连续模式翻页）。
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
      if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true
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
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false }
  }

  // 点击翻页：根据 clickX 在容器宽度的左/中/右决定 -1/0/+1
  // - 中段 30% 不响应，避免用户想"瞄准"图片内容时误触翻页
  // - 缩放 > 1 时不响应（用户想拖动图片而不是翻页）
  // - 双击是独立事件，不会触发 click；拖拽距离 > 3px 时 click 也不触发
  const onContainerClick = (e: React.MouseEvent) => {
    if (!onClickNavigate) return
    if (dragRef.current?.moved) return
    if (mode === 'single' && zoom > 1) return
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const ratio = x / rect.width
    let dir: -1 | 0 | 1 = 0
    if (ratio < 0.35) dir = -1
    else if (ratio > 0.65) dir = 1
    if (dir !== 0) onClickNavigate(dir)
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
  // 背景用透明，让外层（Viewer 的深色画布）决定整体氛围
  const containerCls = isSingle
    ? 'relative flex-1 overflow-auto flex items-center justify-center min-h-0'
    : 'relative flex-1 overflow-auto min-h-0'
  // data-image-viewer 让外部（Viewer 路由）能定位连续模式下的单图
  // （用于 Home/End 跳到首/尾图片的 scrollIntoView）。
  const dataImageViewerProps = { 'data-image-viewer': '' } as const

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
        onClick={onContainerClick}
        {...dataImageViewerProps}
      >
        {current ? (
          <img
            key={imgKey}
            src={imageUrl(current)}
            alt={`第 ${index + 1} 张`}
            draggable={false}
            onMouseDown={onMouseDown}
            onDoubleClick={() => {
              const store = useViewerStore.getState()
              if (store.zoom > 1) {
                store.zoomReset()
                setPan({ x: 0, y: 0 })
              } else {
                // 与滚轮/键盘 `+` 一致：每次 +20%
                store.zoomIn()
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
        onClick={onContainerClick}
        {...dataImageViewerProps}
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
              zoom={zoom}
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
      onClick={onContainerClick}
      {...dataImageViewerProps}
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

// 双张并排模式：每两张为一对，左侧 = index，右侧 = index+1。
// RTL（从右到左翻页）时右侧在前，左侧在后。
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
              alt={`第 ${p.key === 'left' ? '左' : '右'} 页`}
              draggable={false}
              loading="eager"
              className={`select-none ${pageClass()}`}
            />
          ) : (
            <div className="text-fg-subtle text-xs">（空白）</div>
          )}
        </div>
      ))}
    </div>
  )
}

// 连续模式下的单张图：根据 fit 模式选择样式。
// 关键：使用 maxWidth: 100% + block 布局，让图片按比例缩放并触发容器纵向滚动。
// 缩放：用 transform: scale(zoom) 叠加在 fit 尺寸之上，
//   transform-origin 设为 top center，缩放时从顶部对齐，
//   整体高度随之增加 → 容器自然出现纵向滚动条，用户可继续往下看。
interface ContinuousImageProps {
  src: string
  index: number
  aspect: Aspect
  nearIndex: boolean
  isRotated: boolean
  zoom: number
}

function ContinuousImage({ src, index, aspect, nearIndex, isRotated, zoom }: ContinuousImageProps) {
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

  // 缩放：连续模式下用 transform，避免破坏流式布局。
  // transform-origin: top center → 缩放时图片从顶部对齐，下方自然溢出形成滚动。
  const transforms: string[] = []
  if (zoom !== 1) transforms.push(`scale(${zoom})`)
  if (isRotated) transforms.push('rotate(90deg)')
  if (transforms.length) {
    style = {
      ...style,
      transform: transforms.join(' '),
      transformOrigin: isRotated ? 'center' : 'top center',
    }
  }

  return (
    <div className="w-full flex justify-center" data-image-index={index}>
      <img
        src={imageUrl(src)}
        alt={`第 ${index + 1} 张`}
        draggable={false}
        loading={nearIndex ? 'eager' : 'lazy'}
        decoding={nearIndex ? 'sync' : 'async'}
        className="select-none scale-fade"
        style={style}
      />
    </div>
  )
}
