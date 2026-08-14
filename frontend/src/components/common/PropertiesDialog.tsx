import { useEffect, useState } from 'react'
import { imageInfoApi, type ImageInfo } from '../../api/imageInfo'
import { formatSize } from '../../utils/format'
import { CloseIcon } from './Icon'

interface Props {
  open: boolean
  absPath: string | null
  onClose: () => void
}

export default function PropertiesDialog({ open, absPath, onClose }: Props) {
  const [info, setInfo] = useState<ImageInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !absPath) return
    setInfo(null)
    setErr(null)
    imageInfoApi
      .get(absPath)
      .then(setInfo)
      .catch((e) => setErr(e.message ?? '加载失败'))
  }, [open, absPath])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-bg-elevated rounded-lg shadow-lg border border-border w-[480px] max-w-[92vw] overflow-hidden fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="font-display font-semibold">属性</h2>
          <button
            onClick={onClose}
            className="text-fg-muted hover:text-fg p-1 rounded hover:bg-bg-subtle"
            aria-label="关闭"
          >
            <CloseIcon size={16} />
          </button>
        </header>
        <div className="p-5 text-sm">
          {err && <div className="text-danger">错误: {err}</div>}
          {!err && !info && <div className="text-fg-muted">加载中…</div>}
          {info && (
            <dl className="grid grid-cols-[80px_1fr] gap-y-2 gap-x-4">
              <dt className="text-fg-muted text-xs uppercase tracking-wider self-center">文件名</dt>
              <dd className="break-all">{info.name}</dd>
              <dt className="text-fg-muted text-xs uppercase tracking-wider self-center">类型</dt>
              <dd>{info.format.toUpperCase()}</dd>
              <dt className="text-fg-muted text-xs uppercase tracking-wider self-center">尺寸</dt>
              <dd>
                {info.width} × {info.height} px
              </dd>
              <dt className="text-fg-muted text-xs uppercase tracking-wider self-center">大小</dt>
              <dd>{formatSize(info.size)}</dd>
              <dt className="text-fg-muted text-xs uppercase tracking-wider self-center">修改</dt>
              <dd>{info.mtime}</dd>
              <dt className="text-fg-muted text-xs uppercase tracking-wider self-center">路径</dt>
              <dd className="font-mono text-xs break-all text-fg-muted">{info.path}</dd>
            </dl>
          )}
        </div>
      </div>
    </div>
  )
}
