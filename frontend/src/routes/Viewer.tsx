import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useViewerStore } from '../store/viewerStore'
import { useKeyboard } from '../hooks/useKeyboard'
import { albumsApi, progressApi } from '../api/albums'
import { useUIStore } from '../store/uiStore'
import ImageViewer from '../components/viewer/ImageViewer'
import ViewerToolbar from '../components/viewer/ViewerToolbar'
import ImageInfoPanel from '../components/viewer/ImageInfoPanel'
import HelpOverlay from '../components/common/HelpOverlay'

// 查看器页面：从 URL 读取 path/index/name（也兼容旧的 images= 形式）。
// 关闭时持久化阅读进度到后端。
export default function Viewer() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const pushToast = useUIStore((s) => s.pushToast)

  const pathParam = params.get('path') ?? params.get('album') ?? ''
  const initialIndex = Number(params.get('index') ?? 0)
  const name = params.get('name') ?? '查看器'

  // 兼容旧链接（images 数组直接传）
  const initialImages = parseImages(params.get('images'))
  const [images, setImages] = useState<string[]>(initialImages)

  const index = useViewerStore((s) => s.index)
  const setIndex = useViewerStore((s) => s.setIndex)
  const slideshow = useViewerStore((s) => s.slideshow)
  const slideshowInterval = useViewerStore((s) => s.slideshowInterval)
  const setZoom = useViewerStore((s) => s.setZoom)
  const toggleSlideshow = useViewerStore((s) => s.toggleSlideshow)
  const mode = useViewerStore((s) => s.mode)

  const [showInfo, setShowInfo] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    // 通过 path 拉取图片列表（如果还没拉到）
    if (images.length === 0 && pathParam) {
      albumsApi
        .detail(pathParam)
        .then((r) => {
          const d = r.data as { imageFiles?: string[] } | undefined
          if (d && Array.isArray(d.imageFiles)) {
            setImages(d.imageFiles)
          } else {
            pushToast({ kind: 'error', message: '无法读取图片' })
          }
        })
        .catch(() => {
          pushToast({ kind: 'error', message: '无法读取图片' })
        })
      return
    }
    if (images.length === 0) return
    setIndex(Math.max(0, Math.min(images.length - 1, initialIndex)))
    if (!pathParam) return
    progressApi
      .get(pathParam)
      .then((rp) => {
        if (rp && rp.index >= 0 && rp.index < images.length) {
          setIndex(rp.index)
          setZoom(1)
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathParam, images.length === 0])

  useEffect(() => {
    setShowInfo(false)
    if (!pathParam) return
    if (images.length === 0) return
    const t = setTimeout(() => {
      progressApi.set(pathParam, index, images.length, 0).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [index, pathParam, images.length])

  useEffect(() => {
    return () => {
      if (pathParam) {
        navigator.sendBeacon?.(
          '/api/progress',
          new Blob(
            [JSON.stringify({ path: pathParam, index, total: images.length, scroll: 0 })],
            { type: 'application/json' },
          ),
        )
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 切换图片时关闭信息面板 + 防抖持久化进度
  useEffect(() => {
    const off = () => setShowHelp(true)
    window.addEventListener('comic:open-help', off as EventListener)
    return () => window.removeEventListener('comic:open-help', off as EventListener)
  }, [])

  useEffect(() => {
    if (!slideshow) return
    const t = setInterval(() => {
      const cur = useViewerStore.getState().index
      const step = mode === 'double' ? 2 : 1
      if (cur + step < images.length) {
        setIndex(cur + step)
      } else {
        setIndex(0)
      }
    }, slideshowInterval)
    return () => clearInterval(t)
  }, [slideshow, slideshowInterval, images.length, setIndex, mode])

  // 双页模式前进 / 后退 2 页（索引在 onSetMode 中已对齐到偶数）
  function prev() {
    if (mode === 'double') {
      if (index > 0) setIndex(Math.max(0, index - 2))
    } else if (index > 0) {
      setIndex(index - 1)
    }
  }
  function next() {
    if (mode === 'double') {
      // 双页：最后一对不能越界
      if (index + 2 < images.length) setIndex(index + 2)
      else if (index < images.length - 1) setIndex(Math.max(0, images.length - 2))
      else return
    } else if (index < images.length - 1) {
      setIndex(index + 1)
    } else {
      return
    }
    if (index === images.length - 1) {
      pushToast({ kind: 'info', message: '已是最后一张', ttl: 1500 })
      if (useViewerStore.getState().slideshow) {
        toggleSlideshow()
        pushToast({ kind: 'info', message: '幻灯片已自动停止' })
      }
    }
  }

  useKeyboard({
    arrowleft: prev,
    arrowright: next,
    pageup: prev,
    pagedown: next,
    Home: () => setIndex(0),
    End: () => setIndex(images.length - 1),
    '+': () => useViewerStore.getState().zoomIn(),
    '-': () => useViewerStore.getState().zoomOut(),
    '=': () => useViewerStore.getState().zoomIn(),
    '0': () => useViewerStore.getState().zoomReset(),
    r: () => useViewerStore.getState().rotate(90),
    F11: () => {
      if (document.fullscreenElement) document.exitFullscreen()
      else document.documentElement.requestFullscreen()
    },
    space: () => useViewerStore.getState().toggleSlideshow(),
    i: () => setShowInfo((v) => !v),
    'ctrl+/': () => setShowHelp((v) => !v),
    'shift+/': () => setShowHelp((v) => !v),
    // 阅读模式切换：1 单页 / 2 连续 / 3 双页
    '1': () => useViewerStore.getState().setMode('single'),
    '2': () => useViewerStore.getState().setMode('continuous'),
    '3': () => useViewerStore.getState().setMode('double'),
    // 适配循环：F 或 Shift+F（同一个键在原 R 旋转 / Shift+R 重置间区分）
    f: () => useViewerStore.getState().cycleFit(),
    // 阅读方向（双页）
    l: () => {
      const cur = useViewerStore.getState().direction
      useViewerStore.getState().setDirection(cur === 'ltr' ? 'rtl' : 'ltr')
    },
    escape: () => {
      if (showHelp) setShowHelp(false)
      else if (showInfo) setShowInfo(false)
      else navigate(-1)
    },
  })

  if (images.length === 0) {
    return (
      <div className="flex flex-col h-full bg-bg">
        <div className="px-4 h-9 text-xs text-fg-muted border-b border-border-faint bg-bg-elevated/60 flex items-center gap-2">
          <span className="font-medium text-fg truncate">{name}</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-fg-muted text-sm">
            {pathParam ? '正在加载图片…' : '无可显示的图片'}
          </div>
        </div>
      </div>
    )
  }

  const current = images[index]

  return (
    <div className="flex flex-col bg-bg" style={{ height: '100vh' }}>
      <ViewerToolbar
        total={images.length}
        onPrev={prev}
        onNext={next}
        showInfo={showInfo}
        onToggleInfo={() => setShowInfo((v) => !v)}
        onToggleHelp={() => setShowHelp((v) => !v)}
      />
      <div className="px-4 h-9 text-xs text-fg-muted border-b border-border-faint bg-bg-elevated/60 flex items-center gap-2">
        <span className="font-medium text-fg truncate">{name}</span>
        {pathParam && <span className="text-fg-subtle truncate">· {pathParam}</span>}
      </div>
      <div className="flex-1 flex min-h-0">
        <ImageViewer images={images} />
        {showInfo && (
          <ImageInfoPanel absPath={current} onClose={() => setShowInfo(false)} />
        )}
      </div>
      <HelpOverlay open={showHelp} onClose={() => setShowHelp(false)} />
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
