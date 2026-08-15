import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useViewerStore } from '../store/viewerStore'
import { useKeyboard } from '../hooks/useKeyboard'
import { albumsApi } from '../api/albums'
import { progressApi, historyApi } from '../api/prefs'
import { useUIStore } from '../store/uiStore'
import { useFavorites } from '../hooks/useFavorites'
import ImageViewer from '../components/viewer/ImageViewer'
import ViewerToolbar from '../components/viewer/ViewerToolbar'
import PageSlider from '../components/viewer/PageSlider'
import ImageInfoPanel from '../components/viewer/ImageInfoPanel'
import HelpOverlay from '../components/common/HelpOverlay'
import {
  getViewerContext,
  type ViewerContextEntry,
} from '../utils/viewerContext'

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
  const setMode = useViewerStore((s) => s.setMode)

  const [showInfo, setShowInfo] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [markingRead, setMarkingRead] = useState(false)
  const finishedRef = useRef(false)

  const { favorites, toggle: toggleFavorite } = useFavorites()
  const isFav = pathParam ? favorites.includes(pathParam) : false

  // 拉图 + 恢复阅读进度：依赖 pathParam 变化；images 加载完成后由内层判分支
  const imagesReady = images.length > 0
  useEffect(() => {
    // path 拉取图片列表（如果还没拉到）
    if (!imagesReady && pathParam) {
      albumsApi
        .detail(pathParam)
        .then((r) => {
          const d = r.data as { files?: string[]; imageFiles?: string[] } | undefined
          const list = d?.files ?? d?.imageFiles
          if (list && Array.isArray(list)) {
            setImages(list)
          } else {
            pushToast({ kind: 'error', message: '无法读取图片' })
          }
        })
        .catch(() => {
          pushToast({ kind: 'error', message: '无法读取图片' })
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathParam])

  useEffect(() => {
    if (!imagesReady) return
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
  }, [imagesReady, pathParam])

  // 把这次打开写进 history
  useEffect(() => {
    if (!pathParam || images.length === 0) return
    historyApi
      .add({
        path: pathParam,
        name,
        imageCount: images.length,
      })
      .catch(() => {})
  }, [pathParam, name, images.length])

  // 切换图片时关闭信息面板 + 防抖持久化进度
  useEffect(() => {
    setShowInfo(false)
    if (!pathParam) return
    if (images.length === 0) return
    const t = setTimeout(() => {
      progressApi.set(pathParam, index, images.length, 0).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [index, pathParam, images.length])

  // 滚到最后一张：自动标记为「已读」一次。
  // - 不在连续模式用（连续模式 index 不会到达末尾）。
  // - 用 finishedRef 防止重复触发。
  useEffect(() => {
    if (markingRead) return
    if (mode === 'continuous') return
    if (!imagesReady || images.length === 0 || !pathParam) return
    if (index < images.length - 1) {
      finishedRef.current = false
      return
    }
    if (finishedRef.current) return
    finishedRef.current = true
    setMarkingRead(true)
    progressApi
      .set(pathParam, images.length - 1, images.length, 0)
      .then(() => {
        pushToast({ kind: 'success', message: '已读完 🎉', ttl: 1500 })
      })
      .catch(() => {})
      .finally(() => setMarkingRead(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, imagesReady, images.length, pathParam, mode])

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
  // 连续模式不切 index，而是滚动一屏（按容器高度的 90%）。
  function prev() {
    if (mode === 'continuous') {
      scrollStep(-1)
      return
    }
    if (mode === 'double') {
      if (index > 0) setIndex(Math.max(0, index - 2))
    } else if (index > 0) {
      setIndex(index - 1)
    }
  }
  function next() {
    if (mode === 'continuous') {
      scrollStep(1)
      return
    }
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

  // 连续模式：滚动一屏（不切 index）。
  // 点击翻页和键盘 ←/→ 在连续模式下都走这里，体验一致。
  function scrollStep(dir: -1 | 1) {
    const container = document.querySelector(
      '[data-image-viewer]',
    ) as HTMLDivElement | null
    if (!container) return
    const delta = container.clientHeight * 0.9 * dir
    container.scrollBy({ top: delta, behavior: 'smooth' })
  }

  // 连续模式：跳到指定 index 的图片位置（Home/End 用）。
  function scrollContinuousTo(i: number) {
    const target = document.querySelector(`[data-image-index="${i}"]`) as HTMLElement | null
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // 跳到指定页（1-based → 0-based）
  const jumpTo = useCallback(
    (zeroBased: number) => {
      const i = Math.max(0, Math.min(images.length - 1, zeroBased))
      setIndex(i)
    },
    [images.length, setIndex],
  )

  // 上一本 / 下一本（基于上下文栈：主页、收藏、标签页等列表点开时记下）
  const goAdjacent = useCallback(
    (direction: 1 | -1) => {
      const ctx = getViewerContext()
      if (!ctx || ctx.list.length <= 1 || !pathParam) {
        pushToast({
          kind: 'info',
          message: '当前无可用的「上一本 / 下一本」列表',
          ttl: 1500,
        })
        return
      }
      // 优先用当前 key 找索引；找不到时用 ctx.index
      const curIdx = ctx.list.findIndex((it) => it.key === pathParam)
      const base = curIdx >= 0 ? curIdx : ctx.index
      // 计算下一步索引（环形）
      const n = ctx.list.length
      const nextIdx = ((base + direction) % n + n) % n
      const nextEntry: ViewerContextEntry | undefined = ctx.list[nextIdx]
      if (!nextEntry) return
      // 立刻 toast 提示
      const dirLabel = direction === 1 ? '下一本' : '上一本'
      pushToast({
        kind: 'info',
        message: `${dirLabel}：${nextEntry.name}`,
        ttl: 1200,
      })
      // 跳转到新相册：保留上下文，索引更新
      try {
        sessionStorage.setItem(
          'comic-reader-viewer-context',
          JSON.stringify({
            ...ctx,
            index: nextIdx,
            openedAt: Date.now(),
          }),
        )
      } catch {
        // ignore
      }
      // 复位 viewer 内部状态
      setShowInfo(false)
      setMode(useViewerStore.getState().mode)
      // 用 location 替换而不是 push，避免 history 越来越深
      navigate(nextEntry.to, { replace: false })
    },
    [pathParam, pushToast, navigate, setMode],
  )

  // 收藏切换：S 键或工具栏按钮
  const onToggleFavorite = useCallback(() => {
    if (!pathParam) return
    toggleFavorite(pathParam)
      .then(() => {
        const was = favorites.includes(pathParam)
        pushToast({
          kind: 'success',
          message: was ? '已取消收藏' : '已加入收藏',
          ttl: 1200,
        })
      })
      .catch(() => pushToast({ kind: 'error', message: '收藏失败' }))
  }, [pathParam, favorites, toggleFavorite, pushToast])

  useKeyboard({
    arrowleft: prev,
    arrowright: next,
    pageup: prev,
    pagedown: next,
    home: () => {
      // 连续模式：scrollIntoView 而不是 setIndex（index 不动也能跳）
      if (useViewerStore.getState().mode === 'continuous') {
        scrollContinuousTo(0)
      } else {
        setIndex(0)
      }
    },
    end: () => {
      if (useViewerStore.getState().mode === 'continuous') {
        scrollContinuousTo(images.length - 1)
      } else {
        setIndex(images.length - 1)
      }
    },
    '+': () => useViewerStore.getState().zoomIn(),
    '-': () => useViewerStore.getState().zoomOut(),
    '=': () => useViewerStore.getState().zoomIn(),
    '0': () => useViewerStore.getState().zoomReset(),
    r: () => useViewerStore.getState().rotate(90),
    f11: () => {
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
    // 新增：上下本、收藏
    n: () => goAdjacent(1),
    p: () => goAdjacent(-1),
    s: () => onToggleFavorite(),
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
        onPrevAlbum={() => goAdjacent(-1)}
        onNextAlbum={() => goAdjacent(1)}
        onToggleFavorite={onToggleFavorite}
        isFavorite={isFav}
        showInfo={showInfo}
        onToggleInfo={() => setShowInfo((v) => !v)}
        onToggleHelp={() => setShowHelp((v) => !v)}
      />
      <div className="px-4 h-9 text-xs text-fg-muted border-b border-border-faint bg-bg-elevated/60 flex items-center gap-2">
        <span className="font-medium text-fg truncate">{name}</span>
        {pathParam && <span className="text-fg-subtle truncate">· {pathParam}</span>}
      </div>
      <div className="flex-1 flex min-h-0">
        <ImageViewer
          images={images}
          onClickNavigate={(dir) => {
            if (dir === -1) prev()
            else if (dir === 1) next()
            // dir === 0 时中段不响应
          }}
        />
        {showInfo && (
          <ImageInfoPanel absPath={current} onClose={() => setShowInfo(false)} />
        )}
      </div>
      <PageSlider total={images.length} index={index} onJump={jumpTo} images={images} />
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
