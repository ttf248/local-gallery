import { useEffect } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useViewerStore } from '../store/viewerStore'
import { useKeyboard } from '../hooks/useKeyboard'
import ImageViewer from '../components/viewer/ImageViewer'
import ViewerToolbar from '../components/viewer/ViewerToolbar'

// 查看器页面：从 URL ?images=<json>&index=<n> 读取图片列表和起始索引。
export default function Viewer() {
  const { albumPath } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const images = parseImages(params.get('images'))
  const initialIndex = Number(params.get('index') ?? 0)
  const name = params.get('name') ?? '查看器'

  const index = useViewerStore((s) => s.index)
  const setIndex = useViewerStore((s) => s.setIndex)
  const slideshow = useViewerStore((s) => s.slideshow)
  const slideshowInterval = useViewerStore((s) => s.slideshowInterval)

  // 初始化 index
  useEffect(() => {
    setIndex(Math.max(0, Math.min(images.length - 1, initialIndex)))
  }, [initialIndex, images.length, setIndex])

  // 幻灯片计时器
  useEffect(() => {
    if (!slideshow) return
    const t = setInterval(() => {
      const cur = useViewerStore.getState().index
      if (cur < images.length - 1) {
        setIndex(cur + 1)
      } else {
        setIndex(0)
      }
    }, slideshowInterval)
    return () => clearInterval(t)
  }, [slideshow, slideshowInterval, images.length, setIndex])

  function prev() {
    if (index > 0) setIndex(index - 1)
  }
  function next() {
    if (index < images.length - 1) setIndex(index + 1)
  }

  // 快捷键
  useKeyboard({
    arrowleft: prev,
    arrowright: next,
    home: () => setIndex(0),
    end: () => setIndex(images.length - 1),
    '+': () => useViewerStore.getState().zoomIn(),
    '-': () => useViewerStore.getState().zoomOut(),
    '0': () => useViewerStore.getState().zoomReset(),
    r: () => useViewerStore.getState().rotate(90),
    F11: () => {
      if (document.fullscreenElement) document.exitFullscreen()
      else document.documentElement.requestFullscreen()
    },
    space: () => useViewerStore.getState().toggleSlideshow(),
    escape: () => navigate(-1),
  })

  return (
    <div className="flex flex-col h-full bg-bg">
      <ViewerToolbar total={images.length} onPrev={prev} onNext={next} />
      <div className="px-3 py-1 text-xs text-fg-subtle border-b border-border">
        {name} · {albumPath}
      </div>
      <ImageViewer images={images} />
    </div>
  )
}

function parseImages(raw: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(decodeURIComponent(raw))
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
