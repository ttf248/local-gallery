import { useEffect, useRef } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import { imageUrl } from '../../api/images'

interface Props {
  images: string[]
}

// 单图查看器：CSS transform 实现缩放/旋转，transform-origin 居中。
export default function ImageViewer({ images }: Props) {
  const index = useViewerStore((s) => s.index)
  const zoom = useViewerStore((s) => s.zoom)
  const rotation = useViewerStore((s) => s.rotation)
  const containerRef = useRef<HTMLDivElement>(null)

  const current = images[index]

  // 切换图片时重置 transform
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
      containerRef.current.scrollLeft = 0
    }
  }, [index])

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-auto bg-bg-subtle flex items-center justify-center"
    >
      {current ? (
        <img
          src={imageUrl(current)}
          alt={`page ${index + 1}`}
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: 'center',
            transition: 'transform 0.1s',
          }}
        />
      ) : (
        <div className="text-fg-muted">未选择图片</div>
      )}
    </div>
  )
}
