import { useEffect, useState } from 'react'
import { imageInfoApi, type ImageInfo } from '../../api/imageInfo'
import { formatSize } from '../../utils/format'

interface Props {
  absPath: string | null
  onClose: () => void
}

// 右侧滑出：显示图片元数据。
// 加载/解析失败时给出降级提示，不阻塞主操作。
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
    <aside className="w-72 border-l border-border bg-bg-elevated p-4 overflow-auto text-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">图片信息</h2>
        <button onClick={onClose} className="text-fg-muted hover:text-fg" title="关闭 (I)">
          ✕
        </button>
      </div>

      {loading && <div className="text-fg-muted">加载中…</div>}
      {err && <div className="text-red-400">错误: {err}</div>}
      {info && (
        <dl className="space-y-2">
          <Row label="文件名" value={info.name} />
          <Row label="尺寸" value={`${info.width} × ${info.height}`} />
          <Row label="格式" value={info.format.toUpperCase()} />
          <Row label="大小" value={formatSize(info.size)} />
          <Row label="修改时间" value={info.mtime} />
          <Row label="目录" value={info.dir} mono />
          <Row label="校验和" value={info.checksum} mono />
        </dl>
      )}
    </aside>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-fg-muted text-xs">{label}</dt>
      <dd className={`break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  )
}