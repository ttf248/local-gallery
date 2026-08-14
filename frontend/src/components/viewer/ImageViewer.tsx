import { useEffect, useRef, useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import { imageUrl } from '../../api/images'

interface Props {
  images: string[]
}

// 图片查看器：支持鼠标滚轮缩放、拖拽平移（缩放 > 1 时）。
// 切换图片时重置 transform 与位置。
export default function ImageViewer({ images }: Props) {
  const index = useViewerStore((s) => s.index)
  const zoom = useViewerStore((s) => s.zoom)
  const rotation = useViewerStore((s) => s.rotation)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const current = images[index]

  useEffect(() => {
    setPan({ x: 0, y: 0 })
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
      containerRef.current.scrollLeft = 0
    }
  }, [index])

  // 滚轮缩放（Ctrl + wheel 或者直接 wheel）
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
          ref={imgRef}
          src={imageUrl(current)}
          alt={`page ${index + 1}`}
          draggable={false}
          onMouseDown={onMouseDown}
          onDoubleClick={() => {
            const store = useViewerStore.getState()
            if (store.zoom > 1) store.zoomReset()
            else store.setZoom(1.5)
            setPan({ x: 0, y: 0 })
          }}
          className={`max-w-full max-h-full object-contain select-none ${
            zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
          }`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: 'center',
            transition: dragRef.current ? 'none' : 'transform 120ms var(--ease-out)',
          }}
        />
      ) : (
        <div className="text-fg-muted">未选择图片</div>
      )}
    </div>
  )
}
