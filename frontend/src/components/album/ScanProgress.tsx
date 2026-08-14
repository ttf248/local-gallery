import { ProgressEvent } from '../../api/scan'
import { ScanIcon, CloseIcon } from '../common/Icon'

interface Props {
  progress: ProgressEvent | null
  onCancel?: () => void
}

export default function ScanProgress({ progress, onCancel }: Props) {
  if (!progress || progress.status === 'complete') return null
  const pct = Math.max(0, Math.min(100, progress.progress))
  return (
    <div className="fixed top-16 right-4 z-40 bg-bg-elevated border border-border rounded-md shadow-md w-72 overflow-hidden fade-up">
      <div className="flex items-center justify-between px-3 py-2 text-xs">
        <div className="flex items-center gap-2 text-fg">
          <ScanIcon size={13} className="text-fg-muted" />
          <span className="font-medium">
            {progress.status === 'running' ? '扫描中' : progress.status}
          </span>
          <span className="text-fg-muted tabular-nums">{pct}%</span>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-fg-muted hover:text-fg p-1 rounded hover:bg-bg-subtle"
            title="取消扫描"
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
      <div className="h-1 bg-bg-subtle">
        <div className="h-full bg-accent transition-all duration-200" style={{ width: `${pct}%` }} />
      </div>
      <div className="px-3 py-2 text-[11px] text-fg-muted">
        已发现 <span className="text-fg tabular-nums">{progress.albumsFound}</span> 本相册
        {progress.currentPath && (
          <div className="truncate mt-1 text-fg-subtle" title={progress.currentPath}>
            {progress.currentPath.split(/[\\/]/).pop()}
          </div>
        )}
      </div>
    </div>
  )
}
