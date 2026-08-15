import { useEffect, useState } from 'react'
import { imageInfoApi, type ImageInfo } from '../../api/imageInfo'
import { formatSize } from '../../utils/format'
import { CloseIcon, CopyIcon, CheckIcon } from '../common/Icon'
import { useUIStore } from '../../store/uiStore'

interface Props {
  absPath: string | null
  onClose: () => void
}

// 复制到剪贴板，2 秒后自动复位「已复制」状态。
// 成功时返回 true；失败由 toast 反馈。
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 某些环境（HTTPS / 权限）会拒；下面 fallback
  }
  // 兜底：textarea + execCommand（旧浏览器/不安全上下文）
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// 查看器右侧图片信息面板。
export default function ImageInfoPanel({ absPath, onClose }: Props) {
  const [info, setInfo] = useState<ImageInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const pushToast = useUIStore((s) => s.pushToast)

  useEffect(() => {
    if (!absPath) {
      setInfo(null)
      return
    }
    setLoading(true)
    setErr(null)
    imageInfoApi
      .get(absPath)
      .then((d) => setInfo(d))
      .catch((e) => setErr(e.message ?? '加载失败'))
      .finally(() => setLoading(false))
  }, [absPath])

  // 复制状态：键是字段名（filename / dir / checksum），值是当前是否「已复制」提示中
  const [copied, setCopied] = useState<Record<string, boolean>>({})
  function onCopy(field: string, value: string) {
    copyToClipboard(value).then((ok) => {
      if (ok) {
        setCopied((m) => ({ ...m, [field]: true }))
        setTimeout(() => setCopied((m) => ({ ...m, [field]: false })), 1500)
      } else {
        pushToast({ kind: 'error', message: '复制失败，请检查浏览器权限' })
      }
    })
  }

  if (!absPath) return null

  return (
    <aside className="w-72 border-l border-border-faint glass flex flex-col">
      <div className="flex items-center justify-between px-4 h-12 border-b border-border-faint">
        <h2 className="font-display text-[13px] font-medium">图片信息</h2>
        <button
          onClick={onClose}
          className="text-fg-muted hover:text-fg p-1 rounded hover:bg-bg-subtle transition-colors"
          title="关闭 (I)"
        >
          <CloseIcon size={13} />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 text-sm space-y-3 scroll-thin">
        {loading && <div className="text-fg-muted text-xs">加载中…</div>}
        {err && <div className="text-danger text-xs">错误: {err}</div>}
        {info && (
          <>
            <Row
              label="文件名"
              value={info.name}
              copyable
              copied={!!copied.filename}
              onCopy={() => onCopy('filename', info.name)}
            />
            <Row label="尺寸" value={`${info.width} × ${info.height}`} />
            <Row label="格式" value={info.format.toUpperCase()} />
            <Row label="大小" value={formatSize(info.size)} />
            <Row label="修改时间" value={info.mtime} />
            <Row
              label="目录"
              value={info.dir}
              mono
              copyable
              copied={!!copied.dir}
              onCopy={() => onCopy('dir', info.dir)}
            />
            <Row
              label="校验和"
              value={info.checksum}
              mono
              copyable
              copied={!!copied.checksum}
              onCopy={() => onCopy('checksum', info.checksum)}
            />
          </>
        )}
      </div>
    </aside>
  )
}

interface RowProps {
  label: string
  value: string
  mono?: boolean
  /** 是否显示右侧的复制按钮 */
  copyable?: boolean
  /** 是否处于「已复制」状态（1.5 秒后自动复位） */
  copied?: boolean
  onCopy?: () => void
}

function Row({ label, value, mono, copyable, copied, onCopy }: RowProps) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle mb-1 flex items-center gap-1.5">
        <span>{label}</span>
        {copyable && onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center justify-center w-4 h-4 rounded text-fg-subtle hover:text-fg hover:bg-bg-subtle transition-colors"
            title={copied ? '已复制' : '复制'}
            aria-label={copied ? '已复制' : '复制'}
          >
            {copied ? <CheckIcon size={10} /> : <CopyIcon size={10} />}
          </button>
        )}
      </div>
      <div className={`break-all ${mono ? 'font-mono text-[11px] text-fg-muted' : ''}`}>{value}</div>
    </div>
  )
}
