import { useCallback, useEffect, useRef, useState } from 'react'
import { thumbUrl, uploadVideoCover } from '../api/thumbs'

// 视频封面状态机：
//   idle      — 未启动
//   loading   — 正在检查后端是否已有缓存封面（HEAD）
//   missing   — 后端无封面，需要浏览器抽帧
//   extracting— 正在 <video>+canvas 抽帧 + POST
//   ready     — 封面已就绪（命中缓存 / 上传成功）
//   error     — 抽帧失败（用户可在 UI 触发重试）
export type VideoCoverStatus =
  | 'idle'
  | 'loading'
  | 'missing'
  | 'extracting'
  | 'ready'
  | 'error'

interface Options {
  /** 状态变化时回调（父组件可据此显示 spinner / 错误提示） */
  onStatusChange?: (status: VideoCoverStatus) => void
}

interface Result {
  status: VideoCoverStatus
  /** 给 <img src=...> 用的 URL。bust 是为了"抽帧完成"后强制 reload。 */
  url: string
  /** 手动重试（用于 UI 上的"重试"按钮）。 */
  retry: () => void
  /** 当前为视频（path 非空） */
  enabled: boolean
}

const SEEK_RATIO = 0.1 // 抽帧位置 = duration * 10%（太靠前常是黑屏）
const SEEK_MIN = 1.0 // 最少 1s，避免取到片头黑场
const SEEK_MAX = 3.0 // 最多 3s，避免长片抽过开场
const FRAME_MAX_W = 1920 // canvas 导出最大宽（防止超大视频爆内存）

/**
 * 视频封面状态管理 hook。
 *
 * 流程：
 *   1) 挂载时 HEAD 探测 /api/thumbs?path=<video>；200 → ready
 *   2) 404 + code=video_cover_missing → 进入 extracting
 *   3) extracting：<video> 元素 hidden 加载，seek 到 ~10% 位置，drawImage 到
 *      canvas，toBlob → POST /api/thumbs/cover；成功后 bust 计数 +1 让
 *      <img> 重新请求，状态切到 ready
 *   4) 失败：error；调用方可通过 retry() 重试
 */
export function useVideoCover(videoPath: string | null | undefined, opts: Options = {}): Result {
  const [status, setStatus] = useState<VideoCoverStatus>(videoPath ? 'loading' : 'idle')
  const [bust, setBust] = useState(0)
  // 防止 effect 重复触发 extracting（StrictMode 双 mount 时尤其需要）
  const startedRef = useRef(false)
  // retry() 调用时递增，强制重抽
  const [retryNonce, setRetryNonce] = useState(0)

  const setSt = useCallback(
    (s: VideoCoverStatus) => {
      setStatus(s)
      opts.onStatusChange?.(s)
    },
    [opts],
  )

  // 检查封面是否存在
  useEffect(() => {
    if (!videoPath) {
      setSt('idle')
      return
    }
    let cancelled = false
    startedRef.current = false
    setSt('loading')
    fetch(thumbUrl(videoPath), { method: 'HEAD' })
      .then((r) => {
        if (cancelled) return
        setSt(r.ok ? 'ready' : 'missing')
      })
      .catch(() => {
        if (cancelled) return
        setSt('missing')
      })
    return () => {
      cancelled = true
    }
    // bust 变化时（上传成功后）也再检查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoPath, bust, retryNonce])

  // 抽帧 + 上传
  const extract = useCallback(async () => {
    if (!videoPath) return
    setSt('extracting')
    try {
      const blob = await captureVideoFrame(videoPath)
      await uploadVideoCover(videoPath, blob)
      setBust((b) => b + 1)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[useVideoCover] extract failed:', err)
      setSt('error')
    }
  }, [videoPath, setSt])

  // 状态为 missing 时自动启动抽帧
  useEffect(() => {
    if (status !== 'missing') return
    if (startedRef.current) return
    startedRef.current = true
    void extract()
  }, [status, extract])

  const retry = useCallback(() => {
    startedRef.current = false
    setRetryNonce((n) => n + 1)
  }, [])

  const url = videoPath ? `${thumbUrl(videoPath)}${bust ? `&_=${bust}` : ''}` : ''
  return { status, url, retry, enabled: !!videoPath }
}

/**
 * 在浏览器内从视频文件抽一帧 JPEG 字节。
 *
 * 步骤：
 *   1) 创建一个不挂到 DOM 的 <video>（挂到 DOM 会触发自动播放限制）
 *   2) 监听 loadedmetadata → 算 seek 目标（duration * 10%，夹到 1~3s）
 *   3) 监听 seeked → drawImage → canvas.toBlob
 *   4) 释放 video.src（revokeObjectURL）
 *
 * 注意：需要传入"绝对路径"，函数内部用 fetch 先把视频流拉成 Blob
 * URL（走 /api/videos，带 Range 支持）。这样跨域 / Range 协商都
 * 交给后端处理。
 */
export async function captureVideoFrame(videoPath: string): Promise<Blob> {
  // 1) 拉取视频作为 Blob（避免直接 src=URL 在某些环境 Range 行为不一致）
  const resp = await fetch(`/api/videos?path=${encodeURIComponent(videoPath)}`)
  if (!resp.ok) {
    throw new Error(`fetch video: HTTP ${resp.status}`)
  }
  const blob = await resp.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const frame = await new Promise<Blob>((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'auto'
      video.muted = true
      video.playsInline = true
      video.crossOrigin = 'anonymous'
      video.src = objectUrl

      const cleanup = () => {
        video.removeAttribute('src')
        video.load()
      }

      video.addEventListener(
        'loadedmetadata',
        () => {
          // 计算抽帧位置
          const d = video.duration
          if (!Number.isFinite(d) || d <= 0) {
            // 兜底：取第 0 帧
            drawFrame(video, 0).then(resolve, reject)
            return
          }
          const target = Math.min(SEEK_MAX, Math.max(SEEK_MIN, d * SEEK_RATIO))
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked)
            drawFrame(video, target).then(resolve, reject)
          }
          video.addEventListener('seeked', onSeeked)
          video.currentTime = target
        },
        { once: true },
      )

      video.addEventListener(
        'error',
        () => {
          cleanup()
          reject(new Error('video load error'))
        },
        { once: true },
      )
    })
    return frame
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function drawFrame(video: HTMLVideoElement, at: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const vw = video.videoWidth || 1280
    const vh = video.videoHeight || 720
    const scale = Math.min(1, FRAME_MAX_W / vw)
    const w = Math.round(vw * scale)
    const h = Math.round(vh * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('canvas 2d not available'))
      return
    }
    try {
      ctx.drawImage(video, 0, 0, w, h)
    } catch (err) {
      reject(err)
      return
    }
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('canvas.toBlob returned null'))
      },
      'image/jpeg',
      0.85,
    )
    // at 是 currentTime 值的副本，留作未来调试
    void at
  })
}
