import { useEffect, useState } from 'react'
import { imageInfoApi, type ImageInfo } from '../../api/imageInfo'
import { formatSize } from '../../utils/format'
import { CloseIcon } from '../common/Icon'

interface Props {
  absPath: string | null
  onClose: () => void
}

export default function ImageInfoPanel({ absPath, onClose }: Props) {
  const [info, setInfo] = useState<ImageInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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

  if (!absPath) return null

  return (
    <aside className="w-72 border-l border-border bg-bg-elevated flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="font-display text-sm font-medium">图片信息</h2>
        <button
          onClick={onClose}
          className="text-fg-muted hover:text-fg p-1 rounded hover:bg-bg-subtle"
          title="关闭 (I)"
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 text-sm space-y-3">
        {loading && <div className="text-fg-muted text-xs">加载中…</div>}
        {err && <div className="text-danger text-xs">错误: {err}</div>}
        {info && (
          <>
            <Row label="文件名" value={info.name} />
            <Row label="尺寸" value={`${info.width} × ${info.height}`} />
            <Row label="格式" value={info.format.toUpperCase()} />
            <Row label="大小" value={formatSize(info.size)} />
            <Row label="修改时间" value={info.mtime} />
            <Row label="目录" value={info.dir} mono />
            <Row label="校验和" value={info.checksum} mono />
          </>
        )}
      </div>
    </aside>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-0.5">
        {label}
      </div>
      <div className={`break-all ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</div>
    </div>
  )
}
