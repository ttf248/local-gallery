import { useEffect, useState } from 'react'
import { ProgressEvent } from '../../api/scan'
import { CloseIcon, CheckIcon, AlertIcon } from '../common/Icon'

interface Props {
  progress: ProgressEvent | null
  onCancel?: () => void
}

// 扫描进度卡：左下角浮起。
//
// 视觉：
//   - 细边 + 玻璃感
//   - 顶部：状态文字 + 百分比 + （进行中）取消按钮
//   - 进度条：accent 色
//   - 底部：已发现本数 / 当前路径
//
// 显示策略：
//   - progress === null → 隐藏
//   - progress.status === 'running' → 显示，按钮可取消
//   - progress.status === 'cancelled' / 'error' → 显示 1.5s 后自动隐藏
//   - progress.status === 'complete' → 显示 3s 后自动隐藏（让用户看到「完成」反馈）
const FADE_DELAY_MS = 3000

export default function ScanProgress({ progress, onCancel }: Props) {
  // 终态后短暂保留显示，再隐藏
  const [showTerminal, setShowTerminal] = useState(false)

  useEffect(() => {
    if (!progress) {
      setShowTerminal(false)
      return
    }
    if (
      progress.status === 'complete' ||
      progress.status === 'cancelled' ||
      progress.status === 'error'
    ) {
      setShowTerminal(true)
      const id = window.setTimeout(() => setShowTerminal(false), FADE_DELAY_MS)
      return () => window.clearTimeout(id)
    }
    setShowTerminal(false)
  }, [progress])

  if (!progress) return null
  if (progress.status === 'running' && showTerminal) {
    // race：极少见；终态刚切回 running 时也不要再显示
    return null
  }
  if (progress.status !== 'running' && !showTerminal) return null

  const isRunning = progress.status === 'running'
  const isComplete = progress.status === 'complete'
  const isError = progress.status === 'error' || progress.status === 'cancelled'
  const pct = Math.max(0, Math.min(100, progress.progress))

  // 终态：标题 + 图标随状态变化
  const statusText = isComplete
    ? '扫描完成'
    : progress.status === 'cancelled'
      ? '已取消'
      : progress.status === 'error'
        ? '扫描失败'
        : '扫描中'
  const StatusIcon = isComplete ? CheckIcon : isError ? AlertIcon : null
  const statusColor = isComplete
    ? 'text-success'
    : isError
      ? 'text-danger'
      : 'text-fg'
  const elapsedSec = (progress.elapsedMs / 1000).toFixed(1)

  return (
    <div
      className="fixed bottom-5 left-5 z-40 glass-strong border border-border rounded-lg shadow-lg w-72 overflow-hidden fade-up"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between px-3 h-9 text-[12px]">
        <div className="flex items-center gap-2">
          {StatusIcon && (
            <StatusIcon
              size={12}
              className={statusColor}
            />
          )}
          <span className={`font-medium ${statusColor}`}>{statusText}</span>
          {isRunning && (
            <span className="text-fg-muted tabular-nums">{pct}%</span>
          )}
          {!isRunning && (
            <span className="text-fg-subtle tabular-nums">
              {progress.albumsFound} 本 · {elapsedSec}s
            </span>
          )}
        </div>
        {isRunning && onCancel && (
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
          className={`h-full transition-all duration-200 ${
            isComplete ? 'bg-success' : isError ? 'bg-danger' : 'bg-accent'
          }`}
          style={{ width: `${isComplete ? 100 : pct}%` }}
        />
      </div>
      <div className="px-3 py-2 text-[11px] text-fg-muted">
        {isRunning ? (
          <>
            已发现 <span className="text-fg tabular-nums">{progress.albumsFound}</span> 本
            {progress.phase && (
              <span className="ml-1.5 text-fg-subtle">
                · {progress.phase === 'smart-grouping' ? '聚合标签中' : '扫描目录'}
              </span>
            )}
            {progress.currentPath && (
              <div className="truncate mt-1 text-fg-subtle" title={progress.currentPath}>
                {progress.currentPath.split(/[\\/]/).pop()}
              </div>
            )}
          </>
        ) : isComplete ? (
          <>
            共 <span className="text-fg tabular-nums">{progress.albumsFound}</span> 个文件夹
            <div className="mt-0.5">耗时 {elapsedSec}s</div>
          </>
        ) : isError ? (
          <>
            <span className="text-danger">{progress.error ?? '扫描中断'}</span>
          </>
        ) : null}
      </div>
    </div>
  )
}
