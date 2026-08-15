import { ProgressEvent } from '../../api/scan'
import { CloseIcon } from '../common/Icon'

interface Props {
  progress: ProgressEvent | null
  onCancel?: () => void
}

// 扫描进度卡：右下角浮起。
// 视觉：极轻的卡片 + 细边 + 数字百分比 + 进度条。
export default function ScanProgress({ progress, onCancel }: Props) {
  if (!progress || progress.status === 'complete') return null
  const pct = Math.max(0, Math.min(100, progress.progress))
  return (
    <div className="fixed bottom-5 left-5 z-40 glass-strong border border-border rounded-lg shadow-lg w-72 overflow-hidden fade-up">
      <div className="flex items-center justify-between px-3 h-9 text-[12px]">
        <div className="flex items-center gap-2 text-fg">
          <span className="font-medium">扫描中</span>
          <span className="text-fg-muted tabular-nums">{pct}%</span>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-fg-muted hover:text-fg p-1 rounded hover:bg-bg-subtle transition-colors"
            title="取消扫描"
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
      <div className="h-0.5 bg-bg-subtle">
        <div
          className="h-full bg-accent transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="px-3 py-2 text-[11px] text-fg-muted">
        已发现 <span className="text-fg tabular-nums">{progress.albumsFound}</span> 本
        {progress.currentPath && (
          <div className="truncate mt-1 text-fg-subtle" title={progress.currentPath}>
            {progress.currentPath.split(/[\\/]/).pop()}
          </div>
        )}
      </div>
    </div>
  )
}
