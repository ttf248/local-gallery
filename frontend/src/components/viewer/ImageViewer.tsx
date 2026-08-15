import { useEffect, useRef, useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import { imageUrl } from '../../api/images'

interface Props {
  images: string[]
}

// 图片查看器：
// - 鼠标滚轮（按住 Ctrl）+ +/- 缩放
// - 缩放 > 1 时可拖拽平移
// - 切换图片时复位 transform，但保留缩放比例记忆
// - 预加载前后各 2 张
export default function ImageViewer({ images }: Props) {
  const index = useViewerStore((s) => s.index)
  const zoom = useViewerStore((s) => s.zoom)
  const rotation = useViewerStore((s) => s.rotation)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [imgKey, setImgKey] = useState(0) // 强制重渲染动画
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const current = images[index]

  useEffect(() => {
    setPan({ x: 0, y: 0 })
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
      containerRef.current.scrollLeft = 0
    }
    setImgKey((k) => k + 1)
  }, [index])

  // 预加载前后 2 张
  useEffect(() => {
    const ranges = [index - 2, index - 1, index + 1, index + 2]
    for (const i of ranges) {
      const p = images[i]
      if (!p) continue
      const img = new Image()
      img.src = imageUrl(p)
    }
  }, [index, images])

  // 滚轮缩放（Ctrl + wheel）
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
    if (zoom <= 1) return
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-auto bg-bg-subtle flex items-center justify-center"
    >
      {current ? (
        <img
          key={imgKey}
          ref={imgRef}
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
          className={`max-w-full max-h-full object-contain select-none scale-fade ${
            zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
          }`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: 'center',
            transition: dragRef.current ? 'none' : 'transform 200ms var(--ease-out)',
          }}
        />
      ) : (
        <div className="text-fg-muted">未选择图片</div>
      )}
    </div>
  )
}
