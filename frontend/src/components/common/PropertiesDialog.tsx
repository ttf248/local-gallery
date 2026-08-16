import { useEffect } from 'react'
import { useImageInfo } from '../../hooks/useImageInfo'
import { formatSize } from '../../utils/format'
import { CloseIcon } from './Icon'
import CopyButton from './CopyButton'

interface Props {
  open: boolean
  absPath: string | null
  onClose: () => void
}

// 文件/图片属性 dialog：与 ImageInfoPanel 共享 useImageInfo + CopyButton，
// 避免在两处分别实现 fetch / 复制 / 字段展示。
export default function PropertiesDialog({ open, absPath, onClose }: Props) {
  const { info, err, loading } = useImageInfo(open ? absPath : null)

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
        className="bg-bg-elevated rounded-xl shadow-lg border border-border w-[480px] max-w-[92vw] overflow-hidden fade-up"
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
        <div className="p-5 text-sm space-y-3">
          {err && <div className="text-danger text-xs">错误: {err}</div>}
          {!err && loading && <div className="text-fg-muted text-xs">加载中…</div>}
          {info && (
            <>
              <Field label="文件名" value={info.name} copyable />
              <Field label="类型" value={info.format.toUpperCase()} />
              <Field
                label="尺寸"
                value={`${info.width} × ${info.height} px`}
              />
              <Field label="大小" value={formatSize(info.size)} />
              <Field label="修改" value={info.mtime} />
              <Field
                label="目录"
                value={info.dir}
                mono
                copyable
              />
              <Field
                label="校验和"
                value={info.checksum}
                mono
                copyable
              />
              <Field
                label="路径"
                value={info.path}
                mono
                copyable
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  mono,
  copyable,
}: {
  label: string
  value: string
  mono?: boolean
  copyable?: boolean
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle mb-1 flex items-center gap-1.5">
        <span>{label}</span>
        {copyable && <CopyButton value={value} />}
      </div>
      <div className={`break-all ${mono ? 'font-mono text-[11px] text-fg-muted' : ''}`}>
        {value}
      </div>
    </div>
  )
}
