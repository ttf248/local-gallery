import { useEffect, useState } from 'react'
import { imageInfoApi, type ImageInfo } from '../../api/imageInfo'
import { formatSize } from '../../utils/format'

interface Props {
  open: boolean
  absPath: string | null
  onClose: () => void
}

// 属性弹窗：模态层，居中卡片，展示图片元数据。
// Esc / 背景点击 / ✕ 关闭；关闭后通过回调归还焦点。
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-bg-elevated rounded-lg shadow-xl border border-border w-[480px] max-w-[92vw] max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-semibold">属性</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="p-4 text-sm">
          {err && <div className="text-danger">错误: {err}</div>}
          {!err && !info && <div className="text-fg-muted">加载中…</div>}
          {info && (
            <dl className="grid grid-cols-[80px_1fr] gap-y-2 gap-x-3">
              <dt className="text-fg-muted">文件名</dt>
              <dd className="break-all">{info.name}</dd>
              <dt className="text-fg-muted">类型</dt>
              <dd>{info.format.toUpperCase()}</dd>
              <dt className="text-fg-muted">尺寸</dt>
              <dd>
                {info.width} × {info.height} px
              </dd>
              <dt className="text-fg-muted">大小</dt>
              <dd>{formatSize(info.size)}</dd>
              <dt className="text-fg-muted">修改</dt>
              <dd>{info.mtime}</dd>
              <dt className="text-fg-muted">路径</dt>
              <dd className="font-mono text-xs break-all">{info.path}</dd>
            </dl>
          )}
        </div>
      </div>
    </div>
  )
}