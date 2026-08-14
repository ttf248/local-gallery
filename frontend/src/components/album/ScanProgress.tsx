import { ProgressEvent } from '../../api/scan'

interface Props {
  progress: ProgressEvent | null
}

export default function ScanProgress({ progress }: Props) {
  if (!progress || progress.status === 'complete') return null
  const pct = Math.max(0, Math.min(100, progress.progress))
  return (
    <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 bg-bg-elevated border border-border rounded shadow px-4 py-2 w-80">
      <div className="flex items-center justify-between text-sm mb-1">
        <span>{progress.status === 'running' ? '扫描中' : progress.status}</span>
        <span>{progress.albumsFound} 相册</span>
      </div>
      <div className="h-1.5 bg-bg-subtle rounded overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
