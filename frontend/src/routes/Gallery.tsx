import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useGalleryStore } from '../store/galleryStore'
import { useKeyboard } from '../hooks/useKeyboard'
import { albumsApi } from '../api/albums'
import { progressApi, historyApi } from '../api/prefs'
import { useUIStore } from '../store/uiStore'
import { useFavorites } from '../hooks/useFavorites'
import { useLibraryStore } from '../store/libraryStore'
import ImageGallery from '../components/gallery/ImageGallery'
import VideoPlayer from '../components/gallery/VideoPlayer'
import PageSlider from '../components/gallery/PageSlider'
import ImageInfoPanel from '../components/gallery/ImageInfoPanel'
import HelpOverlay from '../components/common/HelpOverlay'
import GalleryHeader from '../components/gallery/GalleryHeader'
import GalleryControls from '../components/gallery/GalleryControls'
import ContextMenu, {
  type AnyMenuItem,
} from '../components/album/ContextMenu'
import { ImageIcon, RefreshIcon } from '../components/common/Icon'
import {
  getGalleryContext,
  type GalleryContextEntry,
} from '../utils/galleryContext'

// 画廊页面：从 URL 读取 path/index/name（也兼容旧的 images= 形式）。
// 关闭时持久化阅读进度到后端。
//
// 视觉：沉浸式画廊 — 暗色背景让图片突出，常驻 UI 只留顶部（返回/名称/页码）+ 顶部右侧
//（全屏/菜单），其余控件在鼠标移动时浮出，2s 无操作后自动隐藏。
export default function Gallery() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const pushToast = useUIStore((s) => s.pushToast)
  const queryClient = useQueryClient()

  const pathParam = params.get('path') ?? params.get('album') ?? ''
  const initialIndex = Number(params.get('index') ?? 0)
  const name = params.get('name') ?? '画廊'
  // type=video 走 VideoPlayer；其它（含未传）走 ImageGallery。
  // 视频模式下 progress.index 单位是秒，total 是 duration 秒数。
  const typeParam = (params.get('type') ?? 'image') as 'image' | 'video'
  const isVideo = typeParam === 'video'

  // 兼容旧链接（images 数组直接传）
  const initialImages = parseImages(params.get('images'))
  const [images, setImages] = useState<string[]>(initialImages)
  // 视频文件列表（type=video 时使用）
  const [videos, setVideos] = useState<string[]>([])

  const index = useGalleryStore((s) => s.index)
  const setIndex = useGalleryStore((s) => s.setIndex)
  const slideshow = useGalleryStore((s) => s.slideshow)
  const slideshowInterval = useGalleryStore((s) => s.slideshowInterval)
  const toggleSlideshow = useGalleryStore((s) => s.toggleSlideshow)
  const mode = useGalleryStore((s) => s.mode)
  const setMode = useGalleryStore((s) => s.setMode)

  const [showInfo, setShowInfo] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  // 右键菜单位置(阅读器内任意位置右键都触发)。
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
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
    // 触屏：mousemove 不会触发，需要单独监听 touchstart / pointerdown
    const onTouch = () => markActive()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onTouch)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onTouch)
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    }
  }, [markActive])

  const { favorites, toggle: toggleFavorite } = useFavorites()
  const isFav = pathParam ? favorites.includes(pathParam) : false

  // 当前相册是否已有自定义封面。detail API 响应里带 hasCustomCover 字段。
  const [hasCustomCover, setHasCustomCover] = useState(false)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)
  // 当前展示的文件路径。Gallery 中段才计算 isVideo/images/videos/index → current，
  // 但 onSetCover 要读这个值。放进 ref 让 callback 拿到最新值而不需要把 current
  // 提前到 useCallback 之前（避免引入 forward reference）。
  const currentRef = useRef<string | null>(null)

  // 拉图 + 恢复阅读进度：依赖 pathParam 变化。
  //
  // 重要：必须在 pathParam 每次变化时都重新拉图。从 Album A 导航到 Album B 时，
  // 旧 images 仍留在 state，会让 imagesReady=true 而跳过 fetch，结果仍是 A 的图。
  //
  // 唯一可以跳过的情况：URL 自带了 images= 参数（兼容旧链接），但只对首次生效 —
  // 一旦点过「重试」（reloadKey++）或 pathParam 变化（导航到下一本），都要重新拉。
  const skipInitialFetch = initialImages.length > 0 && reloadKey === 0
  const imagesReady = images.length > 0
  const videosReady = videos.length > 0
  const ready = isVideo ? videosReady : imagesReady
  useEffect(() => {
    if (skipInitialFetch) return
    if (!pathParam) return
    let cancelled = false
    // 切到新 album 前，先把上一个 album 的进度刷一次（去抖的 save 会因为
    // images.length 变 0 而被清理掉，主动写一次更稳）。
    // 关键：用 lastPathRef（上一个 pathParam），不是闭包里的新 pathParam。
    if (lastPathRef.current) {
      const prevTotal = isVideo ? videos.length : images.length
      if (prevTotal > 0) {
        progressApi
          .set(lastPathRef.current, index, prevTotal, 0)
          .catch(() => {})
      }
    }
    lastPathRef.current = pathParam
    setLoadError(null)
    setImages([])
    setVideos([])
    albumsApi
      .detail(pathParam)
      .then((r) => {
        if (cancelled) return
        // 后端 Album JSON：files（推荐）/ imageFiles（兼容），以及 videoFiles
        const d = r.data as
          | { files?: string[]; imageFiles?: string[]; videoFiles?: string[] }
          | undefined
        if (isVideo) {
          const list = d?.videoFiles ?? []
          if (list.length > 0) {
            setVideos(list)
          } else {
            setLoadError('EMPTY')
          }
        } else {
          const list = d?.files ?? d?.imageFiles
          if (list && Array.isArray(list) && list.length > 0) {
            setImages(list)
          } else {
            setLoadError('EMPTY')
          }
        }
        setHasCustomCover(!!(r as { hasCustomCover?: boolean }).hasCustomCover)
      })
      .catch((e) => {
        if (cancelled) return
        const msg =
          (e as Error)?.message || '无法读取媒体（网络或服务异常）'
        setLoadError(msg)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathParam, reloadKey, isVideo])

  useEffect(() => {
    if (!ready) return
    const list = isVideo ? videos : images
    setIndex(Math.max(0, Math.min(list.length - 1, initialIndex)))
    // 切到新 album 时重置缩放/旋转（视频模式不需要；切视频时由
    // <video key=src> 自然重挂载）
    if (!isVideo) {
      useGalleryStore.getState().resetView()
    }
    if (!pathParam) return
    // URL 显式带 index= 时表示「用户点了某张图/某条链接」,跳过 progress 恢复
    // — 否则会从后端 /api/progress 拉出上次位置把 initialIndex 顶掉,
    // 导致「点任意图都跳到上次看到的那张」(Album 详情缩略图 / AlbumCard
    // hover preview 跳进来都会撞这个)。
    const hasExplicitIndex = params.has('index')
    if (hasExplicitIndex) return
    progressApi
      .get(pathParam)
      .then((rp) => {
        if (!rp) return
        // 图片模式：index 视为页码；视频模式：index 是秒数，
        // 不在这里 seek（<video onMetaLoaded> 处理）
        if (!isVideo && rp.index >= 0 && rp.index < list.length) {
          setIndex(rp.index)
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pathParam, isVideo])

  // 把这次打开写进 history
  useEffect(() => {
    if (!pathParam) return
    if (isVideo ? videos.length === 0 : images.length === 0) return
    historyApi
      .add({
        albumId: pathParam,
        name,
        imageCount: isVideo ? videos.length : images.length,
      })
      .then(() => {
        // 让 Recents 立刻刷新，而不是等 30s 缓存过期
        queryClient.invalidateQueries({ queryKey: ['history'] })
      })
      .catch(() => {})
  }, [pathParam, name, videos.length, images.length, isVideo, queryClient])

  // 切换图片/视频时关闭信息面板 + 防抖持久化进度
  useEffect(() => {
    setShowInfo(false)
    if (!pathParam) return
    const total = isVideo ? videos.length : images.length
    if (total === 0) return
    const t = setTimeout(() => {
      progressApi
        .set(pathParam, index, total, 0)
        .then(() => {
          // 让 Home/Recents/Favorites 的 progress-batch + Album 详情 per-album
          // 缓存都失效，回到列表/详情时立刻看到新进度
          queryClient.invalidateQueries({ queryKey: ['progress-batch'] })
          queryClient.invalidateQueries({ queryKey: ['progress'] })
        })
        .catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [index, pathParam, videos.length, images.length, isVideo, queryClient])

  const scrollContinuousTo = useCallback(
    (targetIndex: number) => {
      const target = document.querySelector(
        `[data-image-index="${targetIndex}"]`,
      ) as HTMLElement | null
      if (!target) return
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setIndex(targetIndex)
    },
    [setIndex],
  )

  // 切到连续模式后,容器需要滚到当前 index 对应的那张图。
  // 之前 ImageGallery 的 useEffect 会把 scrollTop 强制 0,导致用户
  // (尤其从 saved progress 恢复)看到的是 index 0,跟 slider / 计数对不上。
  // 这里主动调一次 scrollContinuousTo 把当前 index 滚进来 —— 用 ref 标记
  // 只在「首次进入 continuous」时跑一次,后续切页交给 jumpTo / scrollStep。
  // 注意:首次 mount 模式就是 continuous (galleryStore 从 localStorage 恢复)
  // 也要触发,所以不能用 prevModeRef (初始值就是 continuous,判断失效)。
  const continuousScrolledRef = useRef(false)
  useEffect(() => {
    if (
      !continuousScrolledRef.current &&
      mode === 'continuous' &&
      imagesReady &&
      images.length > 0
    ) {
      continuousScrolledRef.current = true
      // queueMicrotask 让 ImageGallery 的 mode-only useEffect (scrollTop = 0)
      // 先跑完,再 scrollIntoView,避免再次被覆盖
      queueMicrotask(() => scrollContinuousTo(index))
    } else if (mode !== 'continuous') {
      // 离开 continuous 后,允许下次再进入时重新滚一次
      continuousScrolledRef.current = false
    }
  }, [mode, imagesReady, images.length, index, scrollContinuousTo])

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
  }, [
    index,
    imagesReady,
    images.length,
    pathParam,
    mode,
    markingRead,
    pushToast,
  ])

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
                albumId: cur.path,
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
  }, [])

  useEffect(() => {
    const off = () => setShowHelp(true)
    window.addEventListener('gallery:open-help', off as EventListener)
    return () => window.removeEventListener('gallery:open-help', off as EventListener)
  }, [])

  useEffect(() => {
    if (!slideshow) return
    const t = setInterval(() => {
      const cur = useGalleryStore.getState().index
      const step = mode === 'double' ? 2 : 1
      if (cur + step < images.length) {
        setIndex(cur + step)
      } else {
        // 末尾:对齐手动 next() 的反馈(避免幻灯片 loop 回 0 与
        // 手动翻页的"已是最后一张"行为割裂),toast + 自动停。
        onReachEnd()
      }
    }, slideshowInterval)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // 用 ref 持有,避免 setInterval 闭包捕获旧的 onReachEnd 引用
  // (slideshow effect 的 deps 不包含 pushToast/toggleSlideshow,这些会
  // 因 user 操作 stale,但回调需要读最新 store + push 最新 toast)。
  const onReachEndRef = useRef<() => void>(() => {})
  onReachEndRef.current = () => {
    pushToast({ kind: 'info', message: '已是最后一张', ttl: 1500 })
    if (useGalleryStore.getState().slideshow) {
      toggleSlideshow()
      pushToast({ kind: 'info', message: '幻灯片已自动停止' })
    }
  }
  const onReachEnd = useCallback(() => onReachEndRef.current(), [])

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
      '[data-image-gallery]',
    ) as HTMLDivElement | null
    if (!container) return
    const delta = container.clientHeight * 0.9 * dir
    container.scrollBy({ top: delta, behavior: 'smooth' })
  }

  const jumpTo = useCallback(
    (zeroBased: number) => {
      const i = Math.max(0, Math.min(images.length - 1, zeroBased))
      setIndex(i)
      // continuous 模式：setIndex 不会自动滚动，单独触发一次
      if (useGalleryStore.getState().mode === 'continuous') {
        scrollContinuousTo(i)
      }
    },
    [images.length, scrollContinuousTo, setIndex],
  )

  const goAdjacent = useCallback(
    (direction: 1 | -1) => {
      const ctx = getGalleryContext()
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
      const nextEntry: GalleryContextEntry | undefined = ctx.list[nextIdx]
      if (!nextEntry) return
      const dirLabel = direction === 1 ? '下一本' : '上一本'
      pushToast({
        kind: 'info',
        message: `${dirLabel}：${nextEntry.name}`,
        ttl: 1200,
      })
      try {
        sessionStorage.setItem(
          'local-gallery-context',
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
      setMode(useGalleryStore.getState().mode)
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

  // 把当前展示的图片/视频设为本相册的封面。
  // 设完后立即 loadFromBackend() 拉新 ScanResult，让卡片网格的缩略图实时换封面。
  // hasCustomCover 也同步置 true，让「清除自定义封面」入口显示出来。
  //
  // 注：current 是在组件后段计算的（依赖 isVideo / images / videos / index），
  // 因此这里在 callback 内通过 useGalleryStore.getState() 读 index、images、videos
  // 实时算 current，避免 deps 出现 forward reference。空数组 deps 等价于「挂载时
  // 一次性」，callback 内部读最新 state，每次按键都拿到当前真实文件。
  const onSetCover = useCallback(() => {
    if (!pathParam) return
    const cur = currentRef.current
    if (!cur) return
    albumsApi
      .setCover(pathParam, cur)
      .then(() => {
        setHasCustomCover(true)
        loadFromBackend().catch(() => {})
        pushToast({ kind: 'success', message: '已设为封面', ttl: 1200 })
      })
      .catch((e) => {
        const msg = (e as { body?: { error?: string } })?.body?.error || '设置封面失败'
        pushToast({ kind: 'error', message: msg })
      })
  }, [pathParam, loadFromBackend, pushToast])

  // 清除自定义封面：回退到扫描器默认（images[0] / videos[0]）。
  const onClearCover = useCallback(() => {
    if (!pathParam) return
    albumsApi
      .clearCover(pathParam)
      .then(() => {
        setHasCustomCover(false)
        loadFromBackend().catch(() => {})
        pushToast({ kind: 'success', message: '已恢复默认封面', ttl: 1200 })
      })
      .catch((e) => {
        const msg = (e as { body?: { error?: string } })?.body?.error || '清除封面失败'
        pushToast({ kind: 'error', message: msg })
      })
  }, [pathParam, loadFromBackend, pushToast])

  useKeyboard({
    arrowleft: prev,
    arrowright: next,
    pageup: prev,
    pagedown: next,
    home: () => {
      if (useGalleryStore.getState().mode === 'continuous') {
        scrollContinuousTo(0)
      } else {
        setIndex(0)
      }
    },
    end: () => {
      if (useGalleryStore.getState().mode === 'continuous') {
        scrollContinuousTo(images.length - 1)
      } else {
        setIndex(images.length - 1)
      }
    },
    '+': () => useGalleryStore.getState().zoomIn(),
    '-': () => useGalleryStore.getState().zoomOut(),
    '=': () => useGalleryStore.getState().zoomIn(),
    '0': () => useGalleryStore.getState().zoomReset(),
    r: () => useGalleryStore.getState().rotate(90),
    f11: () => useGalleryStore.getState().toggleFullscreen(),
    space: () => useGalleryStore.getState().toggleSlideshow(),
    i: () => setShowInfo((v) => !v),
    'ctrl+/': () => setShowHelp((v) => !v),
    '?': () => setShowHelp((v) => !v),
    '1': () => useGalleryStore.getState().setMode('single'),
    '2': () => useGalleryStore.getState().setMode('continuous'),
    '3': () => useGalleryStore.getState().setMode('double'),
    f: () => useGalleryStore.getState().cycleFit(),
    l: () => {
      const cur = useGalleryStore.getState().direction
      useGalleryStore.getState().setDirection(cur === 'ltr' ? 'rtl' : 'ltr')
    },
    n: () => goAdjacent(1),
    p: () => goAdjacent(-1),
    s: () => onToggleFavorite(),
    u: () => onSetCover(),
    'shift+u': () => onClearCover(),
    escape: () => {
      if (showHelp) setShowHelp(false)
      else if (showInfo) setShowInfo(false)
      // images.length === 0 时表示仍在 loading/empty/error 态：
      // 按 ESC 不应退到上一页，避免用户误操作导致上下文丢失（特别是切 album
      // 期间按 ESC 直接退回 Home，体验割裂）。
      else if (images.length > 0) navigate(-1)
    },
  })

  if (!ready) {
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

  // 显示给用户看的 item index（1 / 2 那种）。
  // 视频模式下 store.index 被 VideoPlayer.onProgress 反复写成播放秒数（浮点），
  // 跟「item 编号」不再同义。视频模式下 current / itemIndex 都基于
  // initialIndex（带 URL 显式覆盖的语义），不跟 store.index 走。
  const videoItemIndex = isVideo
    ? Math.max(0, Math.min(initialIndex, Math.max(0, videos.length - 1)))
    : Math.floor(index)

  const current = isVideo ? videos[videoItemIndex] : images[index]
  // 把 current 同步进 ref,让 onSetCover (声明在前) 拿到最新值。
  currentRef.current = current
  const total = isVideo ? videos.length : images.length
  const itemIndex = videoItemIndex

  return (
    <div
      className="relative bg-neutral-950 overflow-hidden select-none"
      style={{ height: '100vh' }}
      onMouseMove={markActive}
      onContextMenu={(e) => {
        // 屏蔽浏览器默认右键菜单(图片另存为等),改用我们自己的。
        // 子组件 (ImageGallery/VideoPlayer) 内部各自 preventDefault + 标记
        // 是图片区,这里统一捕获后弹自定义菜单。
        e.preventDefault()
        if (!pathParam) return
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {/* 暗色画布层：让图片有「画廊」氛围 */}
      {/* flex flex-col 是关键：让 ImageGallery 内部的 `flex-1` + `min-h-0`
          容器拿到约束高度,连续模式才能在容器内纵向滚动,
          而不是被外层 overflow-hidden 裁掉。 */}
      <div className="absolute inset-0 flex flex-col">
        {isVideo ? (
          <VideoPlayer
            src={current ?? ''}
            onProgress={(sec) => {
              // 视频模式下 index = currentTime（秒）；防抖 600ms 落盘
              useGalleryStore.getState().setIndex(sec)
            }}
            onEnded={() => {
              if (index < videos.length - 1) next()
              else {
                pushToast({ kind: 'success', message: '已看完 🎉', ttl: 1500 })
              }
            }}
            onMetaLoaded={() => {
              // loadedmetadata 后，尝试恢复之前的播放进度
              if (!pathParam) return
              progressApi
                .get(pathParam)
                .then((rp) => {
                  if (rp && Number.isFinite(rp.total) && rp.total > 0) {
                    // 仅当 total 是秒数时（视频），才用 index 当 currentTime
                    if (rp.index > 0 && rp.index < rp.total) {
                      useGalleryStore.getState().setIndex(rp.index)
                    }
                  }
                })
                .catch(() => {})
            }}
          />
        ) : (
          <ImageGallery
            images={images}
            onClickNavigate={(dir) => {
              if (dir === -1) prev()
              else if (dir === 1) next()
            }}
          />
        )}
      </div>

      {/* 顶部常驻条：返回 / 名称 / 页码 / 全屏 / 菜单 */}
      <GalleryHeader
        name={name}
        index={index}
        itemIndex={isVideo ? itemIndex : undefined}
        total={total}
        isFavorite={isFav}
        onBack={() => navigate(-1)}
        onToggleFavorite={onToggleFavorite}
        onToggleInfo={() => setShowInfo((v) => !v)}
        onToggleHelp={() => setShowHelp((v) => !v)}
        onPrev={prev}
        onNext={next}
        onPrevAlbum={() => goAdjacent(-1)}
        onNextAlbum={() => goAdjacent(1)}
        onSetCover={onSetCover}
        onClearCover={onClearCover}
        hasCustomCover={hasCustomCover}
      />

      {/* 浮层控件：右侧（模式 / 适配 / 缩放 / 旋转 / 方向）+ 左下（上一本/下一本）
          视频模式不显示（视频有原生 controls） */}
      {!isVideo && (
        <GalleryControls
          visible={chromeVisible}
          onPrev={prev}
          onNext={next}
          onPrevAlbum={() => goAdjacent(-1)}
          onNextAlbum={() => goAdjacent(1)}
        />
      )}

      {/* 底部进度条 + 跳转：浮在图上，chromeVisible 联动。视频模式下隐藏（<video> 自带 controls） */}
      {!isVideo && (
        <div
          className={`absolute bottom-0 inset-x-0 z-10 transition-opacity duration-300 ${
            chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <PageSlider total={images.length} index={index} onJump={jumpTo} images={images} />
        </div>
      )}

      {showInfo && !isVideo && current && (
        <ImageInfoPanel absPath={current} onClose={() => setShowInfo(false)} />
      )}
      <HelpOverlay open={showHelp} onClose={() => setShowHelp(false)} />
      {/* 右键菜单：阅读器内任意位置右键都弹出。
          「设为封面」「清除自定义封面」用与 GalleryHeader 同一份 handler，
          保证快捷键 U / ⇧U 与菜单行为完全一致。 */}
      {contextMenu && pathParam && current && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={
            [
              {
                id: 'set-cover',
                label: '设为封面 (U)',
                icon: <ImageIcon />,
              },
              hasCustomCover
                ? {
                    id: 'clear-cover',
                    label: '清除自定义封面 (⇧U)',
                    icon: <RefreshIcon />,
                  }
                : { id: 'clear-cover-disabled', label: '清除自定义封面', disabled: true },
            ] satisfies AnyMenuItem[]
          }
          onSelect={(id) => {
            setContextMenu(null)
            if (id === 'set-cover') onSetCover()
            else if (id === 'clear-cover') onClearCover()
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
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
