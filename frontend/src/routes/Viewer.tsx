import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useViewerStore } from '../store/viewerStore'
import { useKeyboard } from '../hooks/useKeyboard'
import { albumsApi } from '../api/albums'
import { progressApi, historyApi } from '../api/prefs'
import { useUIStore } from '../store/uiStore'
import { useFavorites } from '../hooks/useFavorites'
import ImageViewer from '../components/viewer/ImageViewer'
import PageSlider from '../components/viewer/PageSlider'
import ImageInfoPanel from '../components/viewer/ImageInfoPanel'
import HelpOverlay from '../components/common/HelpOverlay'
import ViewerHeader from '../components/viewer/ViewerHeader'
import ViewerControls from '../components/viewer/ViewerControls'
import {
  getViewerContext,
  type ViewerContextEntry,
} from '../utils/viewerContext'

// 查看器页面：从 URL 读取 path/index/name（也兼容旧的 images= 形式）。
// 关闭时持久化阅读进度到后端。
//
// 视觉：沉浸式阅读器 — 暗色背景让图片突出，常驻 UI 只留顶部（返回/名称/页码）+ 顶部右侧
//（全屏/菜单），其余控件在鼠标移动时浮出，2s 无操作后自动隐藏。
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const finishedRef = useRef(false)
  // 持有「最新」index/total；sendBeacon 关闭时从这里取最新值。
  // 同时记录 path，只有 images 有效时才更新 — 避免切到新 album 的 loading
  // 阶段把 path 也更新成新的，导致 sendBeacon 发往错的 album。
  const progressRef = useRef<{ path: string; index: number; total: number }>({
    path: '',
    index: 0,
    total: 0,
  })
  useEffect(() => {
    if (images.length > 0 && pathParam) {
      progressRef.current = { path: pathParam, index, total: images.length }
    }
  }, [index, images.length, pathParam])
  // 记录「上一个」pathParam；切 album 时用它来保存上一个的进度，
  // 而不是用 effect 闭包里的新 pathParam（会写错位置）。
  const lastPathRef = useRef<string>('')

  // 浮层显隐：鼠标移动时显出，2s 无动作后自动隐藏。
  // 不影响顶部常驻条（始终可见）。
  const [chromeVisible, setChromeVisible] = useState(true)
  const idleTimerRef = useRef<number | null>(null)
  const markActive = useCallback(() => {
    setChromeVisible(true)
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current)
    }
    idleTimerRef.current = window.setTimeout(() => {
      setChromeVisible(false)
    }, 2500)
  }, [])

  useEffect(() => {
    markActive()
    const onMove = () => markActive()
    const onKey = () => markActive()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('keydown', onKey)
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    }
  }, [markActive])

  const { favorites, toggle: toggleFavorite } = useFavorites()
  const isFav = pathParam ? favorites.includes(pathParam) : false

  // 拉图 + 恢复阅读进度：依赖 pathParam 变化。
  //
  // 重要：必须在 pathParam 每次变化时都重新拉图。从 Album A 导航到 Album B 时，
  // 旧 images 仍留在 state，会让 imagesReady=true 而跳过 fetch，结果仍是 A 的图。
  //
  // 唯一可以跳过的情况：URL 自带了 images= 参数（兼容旧链接），但只对首次生效 —
  // 一旦点过「重试」（reloadKey++）或 pathParam 变化（导航到下一本），都要重新拉。
  const skipInitialFetch = initialImages.length > 0 && reloadKey === 0
  const imagesReady = images.length > 0
  useEffect(() => {
    if (skipInitialFetch) return
    if (!pathParam) return
    let cancelled = false
    // 切到新 album 前，先把上一个 album 的进度刷一次（去抖的 save 会因为
    // images.length 变 0 而被清理掉，主动写一次更稳）。
    // 关键：用 lastPathRef（上一个 pathParam），不是闭包里的新 pathParam。
    if (lastPathRef.current && images.length > 0) {
      progressApi
        .set(lastPathRef.current, index, images.length, 0)
        .catch(() => {})
    }
    lastPathRef.current = pathParam
    setLoadError(null)
    setImages([])
    albumsApi
      .detail(pathParam)
      .then((r) => {
        if (cancelled) return
        const d = r.data as { files?: string[]; imageFiles?: string[] } | undefined
        const list = d?.files ?? d?.imageFiles
        if (list && Array.isArray(list) && list.length > 0) {
          setImages(list)
        } else {
          setLoadError('EMPTY')
        }
      })
      .catch((e) => {
        if (cancelled) return
        const msg =
          (e as Error)?.message || '无法读取图片（网络或服务异常）'
        setLoadError(msg)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathParam, reloadKey])

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
      // 组件卸载时把「最后有效」的进度发出去：
      // - path/index/total 都从 ref 取，避免切到新 album 后闭包陷阱
      // - total > 0 守卫：loading 阶段不发空进度
      const cur = progressRef.current
      if (cur.path && cur.total > 0) {
        navigator.sendBeacon?.(
          '/api/progress',
          new Blob(
            [
              JSON.stringify({
                path: cur.path,
                index: cur.index,
                total: cur.total,
                scroll: 0,
              }),
            ],
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
  // 已到末尾的统一反馈：toast + 自动停幻灯片。
  const onReachEnd = () => {
    pushToast({ kind: 'info', message: '已是最后一张', ttl: 1500 })
    if (useViewerStore.getState().slideshow) {
      toggleSlideshow()
      pushToast({ kind: 'info', message: '幻灯片已自动停止' })
    }
  }

  function next() {
    if (mode === 'continuous') {
      scrollStep(1)
      return
    }
    if (mode === 'double') {
      if (index + 2 < images.length) {
        setIndex(index + 2)
        return
      }
      if (index < images.length - 1) {
        setIndex(Math.max(0, images.length - 2))
        return
      }
      onReachEnd()
      return
    }
    if (index < images.length - 1) {
      setIndex(index + 1)
      return
    }
    onReachEnd()
  }

  function scrollStep(dir: -1 | 1) {
    const container = document.querySelector(
      '[data-image-viewer]',
    ) as HTMLDivElement | null
    if (!container) return
    const delta = container.clientHeight * 0.9 * dir
    container.scrollBy({ top: delta, behavior: 'smooth' })
  }

  function scrollContinuousTo(i: number) {
    const target = document.querySelector(`[data-image-index="${i}"]`) as HTMLElement | null
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // 同步 index，否则后续按 → 会从旧 index 继续，导致视觉/状态错位
    setIndex(i)
  }

  const jumpTo = useCallback(
    (zeroBased: number) => {
      const i = Math.max(0, Math.min(images.length - 1, zeroBased))
      setIndex(i)
    },
    [images.length, setIndex],
  )

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
      const curIdx = ctx.list.findIndex((it) => it.key === pathParam)
      const base = curIdx >= 0 ? curIdx : ctx.index
      const n = ctx.list.length
      const nextIdx = ((base + direction) % n + n) % n
      const nextEntry: ViewerContextEntry | undefined = ctx.list[nextIdx]
      if (!nextEntry) return
      const dirLabel = direction === 1 ? '下一本' : '上一本'
      pushToast({
        kind: 'info',
        message: `${dirLabel}：${nextEntry.name}`,
        ttl: 1200,
      })
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
      setShowInfo(false)
      setMode(useViewerStore.getState().mode)
      navigate(nextEntry.to, { replace: false })
    },
    [pathParam, pushToast, navigate, setMode],
  )

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
    '1': () => useViewerStore.getState().setMode('single'),
    '2': () => useViewerStore.getState().setMode('continuous'),
    '3': () => useViewerStore.getState().setMode('double'),
    f: () => useViewerStore.getState().cycleFit(),
    l: () => {
      const cur = useViewerStore.getState().direction
      useViewerStore.getState().setDirection(cur === 'ltr' ? 'rtl' : 'ltr')
    },
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
        {/* 顶部条：返回 / 名称（常驻） */}
        <div className="px-4 h-9 text-xs text-fg-muted border-b border-border-faint bg-bg-elevated/60 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-1.5 py-0.5 rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="返回"
          >
            ←
          </button>
          <span className="font-medium text-fg truncate">{name}</span>
        </div>
        <div className="flex-1 flex items-center justify-center px-6">
          {!pathParam ? (
            <div className="text-center">
              <div className="text-fg-muted text-sm">无可显示的图片</div>
              <div className="text-fg-subtle text-xs mt-1">未指定相册路径</div>
            </div>
          ) : loadError ? (
            <div className="text-center max-w-sm">
              <div className="text-base font-medium text-fg mb-1">
                {loadError === 'EMPTY' ? '这个文件夹没有图片' : '加载失败'}
              </div>
              <div className="text-fg-muted text-sm mb-5">
                {loadError === 'EMPTY'
                  ? '可以换个文件夹，或检查文件是否已被移动/删除。'
                  : loadError}
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="px-4 h-8 text-sm rounded border border-border bg-bg-elevated hover:bg-bg-hover text-fg"
                >
                  返回
                </button>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="px-4 h-8 text-sm rounded bg-accent text-white hover:opacity-90"
                >
                  重试
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-fg-muted text-sm">
              <div
                className="w-5 h-5 rounded-full border-2 border-fg-muted border-t-transparent animate-spin"
                aria-hidden
              />
              <span>正在加载图片…</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  const current = images[index]

  return (
    <div
      className="relative bg-neutral-950 overflow-hidden select-none"
      style={{ height: '100vh' }}
      onMouseMove={markActive}
    >
      {/* 暗色画布层：让图片有「阅读器」氛围 */}
      <div className="absolute inset-0">
        <ImageViewer
          images={images}
          onClickNavigate={(dir) => {
            if (dir === -1) prev()
            else if (dir === 1) next()
          }}
        />
      </div>

      {/* 顶部常驻条：返回 / 名称 / 页码 / 全屏 / 菜单 */}
      <ViewerHeader
        name={name}
        index={index}
        total={images.length}
        isFavorite={isFav}
        onBack={() => navigate(-1)}
        onToggleFavorite={onToggleFavorite}
        onToggleInfo={() => setShowInfo((v) => !v)}
        onToggleHelp={() => setShowHelp((v) => !v)}
        onPrev={prev}
        onNext={next}
        onPrevAlbum={() => goAdjacent(-1)}
        onNextAlbum={() => goAdjacent(1)}
      />

      {/* 浮层控件：右侧（模式 / 适配 / 缩放 / 旋转 / 方向）+ 左下（上一本/下一本） */}
      <ViewerControls
        visible={chromeVisible}
        onPrev={prev}
        onNext={next}
        onPrevAlbum={() => goAdjacent(-1)}
        onNextAlbum={() => goAdjacent(1)}
      />

      {/* 底部进度条 + 跳转：浮在图上，chromeVisible 联动 */}
      <div
        className={`absolute bottom-0 inset-x-0 z-10 transition-opacity duration-300 ${
          chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <PageSlider total={images.length} index={index} onJump={jumpTo} images={images} />
      </div>

      {showInfo && (
        <ImageInfoPanel absPath={current} onClose={() => setShowInfo(false)} />
      )}
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
