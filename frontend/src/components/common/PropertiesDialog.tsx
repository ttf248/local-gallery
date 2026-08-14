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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[2px] fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-bg-elevated rounded-lg shadow-lg border border-border-faint w-[480px] max-w-[92vw] overflow-hidden fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 h-12 border-b border-border-faint">
          <h2 className="font-display text-sm font-medium">属性</h2>
          <button
            onClick={onClose}
            className="text-fg-muted hover:text-fg p-1 rounded hover:bg-bg-subtle transition-colors"
            aria-label="关闭"
          >
            <CloseIcon size={14} />
          </button>
        </header>
        <div className="p-5 text-sm">
          {err && <div className="text-danger text-xs">错误: {err}</div>}
          {!err && !info && <div className="text-fg-muted text-xs">加载中…</div>}
          {info && (
            <dl className="grid grid-cols-[80px_1fr] gap-y-2.5 gap-x-4">
              <FieldLabel>文件名</FieldLabel>
              <dd className="break-all">{info.name}</dd>
              <FieldLabel>类型</FieldLabel>
              <dd>{info.format.toUpperCase()}</dd>
              <FieldLabel>尺寸</FieldLabel>
              <dd>{info.width} × {info.height} px</dd>
              <FieldLabel>大小</FieldLabel>
              <dd>{formatSize(info.size)}</dd>
              <FieldLabel>修改</FieldLabel>
              <dd>{info.mtime}</dd>
              <FieldLabel>路径</FieldLabel>
              <dd className="font-mono text-[11px] break-all text-fg-muted">{info.path}</dd>
            </dl>
          )}
        </div>
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <dt className="text-fg-subtle text-[10px] uppercase tracking-[0.14em] self-center">
      {children}
    </dt>
  )
}
