import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useViewerStore } from '../store/viewerStore'
import { useKeyboard } from '../hooks/useKeyboard'
import { progressApi } from '../api/albums'
import { useUIStore } from '../store/uiStore'
import ImageViewer from '../components/viewer/ImageViewer'
import ViewerToolbar from '../components/viewer/ViewerToolbar'
import ImageInfoPanel from '../components/viewer/ImageInfoPanel'
import HelpOverlay from '../components/common/HelpOverlay'
import EmptyState from '../components/common/EmptyState'

// 查看器页面：从 URL ?images=<json>&index=<n>&name=&album= 读取。
// 关闭时持久化阅读进度到后端。
export default function Viewer() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const pushToast = useUIStore((s) => s.pushToast)

  const images = parseImages(params.get('images'))
  const initialIndex = Number(params.get('index') ?? 0)
  const name = params.get('name') ?? '查看器'
  const album = params.get('album') ?? ''

  const index = useViewerStore((s) => s.index)
  const setIndex = useViewerStore((s) => s.setIndex)
  const slideshow = useViewerStore((s) => s.slideshow)
  const slideshowInterval = useViewerStore((s) => s.slideshowInterval)
  const setZoom = useViewerStore((s) => s.setZoom)
  const toggleSlideshow = useViewerStore((s) => s.toggleSlideshow)

  const [showInfo, setShowInfo] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    if (!album) {
      setIndex(Math.max(0, Math.min(images.length - 1, initialIndex)))
      return
    }
    setIndex(Math.max(0, Math.min(images.length - 1, initialIndex)))
    progressApi
      .get(album)
      .then((rp) => {
        if (rp && rp.index >= 0 && rp.index < images.length) {
          setIndex(rp.index)
          setZoom(1)
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album])

  useEffect(() => {
    setShowInfo(false)
    if (!album) return
    const t = setTimeout(() => {
      progressApi.set(album, index, images.length, 0).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [index, album, images.length])

  useEffect(() => {
    return () => {
      if (album) {
        navigator.sendBeacon?.(
          '/api/progress',
          new Blob(
            [JSON.stringify({ path: album, index, total: images.length, scroll: 0 })],
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
    if (index < images.length - 1) {
      setIndex(index + 1)
      // 末尾自动翻页时若启用 autoSwitchAlbum 则切换下一本
      const prefs = useUIStore.getState()
      // 提示信息（仅最后一张之后）
      if (index + 1 === images.length - 1) {
        pushToast({ kind: 'info', message: '已是最后一页', ttl: 1500 })
      }
      // 最后一页之后关闭幻灯片
      if (index === images.length - 1) {
        if (useViewerStore.getState().slideshow) {
          toggleSlideshow()
          pushToast({ kind: 'info', message: '幻灯片已自动停止' })
        }
      }
      void prefs
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
    escape: () => {
      if (showHelp) setShowHelp(false)
      else if (showInfo) setShowInfo(false)
      else navigate(-1)
    },
  })

  if (images.length === 0) {
    return (
      <EmptyState
        title="无可显示的图片"
        description="请返回相册重新选择。"
        action={
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 rounded-md bg-accent text-accent-fg hover:bg-accent-hover text-sm"
          >
            返回
          </button>
        }
      />
    )
  }

  const current = images[index]

  return (
    <div className="flex flex-col h-full bg-bg">
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
        {album && <span className="text-fg-subtle truncate">· {album}</span>}
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
