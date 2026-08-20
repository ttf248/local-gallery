import { useEffect, useState } from 'react'
import { ProgressEvent } from '../../api/scan'
import {
  CloseIcon,
  CheckIcon,
  AlertIcon,
  ScanIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '../common/Icon'

interface Props {
  progress: ProgressEvent | null
  onCancel?: () => void
  /** 强制展开（例如首次出现时；之后交由用户折叠） */
  defaultExpanded?: boolean
}

// 扫描进度条（顶部 sticky）。
//
// 视觉与交互（v2，从「左下角浮卡」改为「顶部常驻细条」）：
//   - 高度 36px（h-9），不挤掉 main 内容
//   - 默认折叠：状态 + 进度条 + 百分比 + 本数 + 取消按钮，一行搞定
//   - 点击空白区或下箭头 → 展开为 96px 高的详情卡，显示 phase / 当前路径 / 耗时
//   - 终态：3s 内继续可见（让用户看到「完成」反馈），然后滑出
//   - 顶住页面顶部（sticky top-0 z-30），跨页面都看得到（前提：组件挂在 AppShell 等
//     持续挂载的位置，而不是某个特定 route）
//
// 显示策略：
//   - progress === null → 不渲染
//   - status === 'running' / 'pending' → 显示
//   - status === 'complete' / 'cancelled' / 'error' → 继续显示 FADE_DELAY_MS 后滑出
const FADE_DELAY_MS = 3000

export default function ScanProgress({
  progress,
  onCancel,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [phase, setPhase] = useState<'in' | 'visible' | 'out'>('in')

  // 终态后短暂保留显示，再滑出
  const [showTerminal, setShowTerminal] = useState(false)

  useEffect(() => {
    if (!progress) {
      setShowTerminal(false)
      setPhase('out')
      return
    }
    if (
      progress.status === 'complete' ||
      progress.status === 'cancelled' ||
      progress.status === 'error'
    ) {
      setShowTerminal(true)
      setPhase('visible')
      const id = window.setTimeout(() => setPhase('out'), FADE_DELAY_MS)
      return () => window.clearTimeout(id)
    }
    setShowTerminal(false)
    setPhase('visible')
  }, [progress])

  if (!progress) return null
  if (phase === 'out') return null
  if (progress.status === 'running' && showTerminal) {
    // race：刚切回 running 时不要继续显示终态
    return null
  }
  if (progress.status !== 'running' && !showTerminal) return null

  const isRunning = progress.status === 'running' || progress.status === 'pending'
  const isComplete = progress.status === 'complete'
  const isError = progress.status === 'error' || progress.status === 'cancelled'
  const pct = Math.max(0, Math.min(100, progress.progress))
  const elapsedSec = (progress.elapsedMs / 1000).toFixed(1)
  const fileName =
    progress.currentPath?.split(/[\\/]/).filter(Boolean).pop() ?? ''

  // 状态条
  const barColor = isComplete
    ? 'bg-success'
    : isError
      ? 'bg-danger'
      : 'bg-accent'

  // 状态文案 + 图标
  const StatusIcon = isComplete ? CheckIcon : isError ? AlertIcon : ScanIcon
  const statusText = isComplete
    ? '扫描完成'
    : progress.status === 'cancelled'
      ? '已取消'
      : progress.status === 'error'
        ? '扫描失败'
        : '扫描中'
  const statusColor = isComplete
    ? 'text-success'
    : isError
      ? 'text-danger'
      : 'text-fg'

  const phaseLabel =
    progress.phase === 'smart-grouping'
      ? '聚合标签中'
      : progress.phase === 'done'
        ? '收尾中'
        : '扫描目录'

  return (
    <div
      // 顶部 sticky，与 Toolbar 共享顶部空间 — z-30 放在 Toolbar 下方避免遮挡 logo/搜索
      className="sticky top-0 z-30 border-b border-border-faint glass-strong fade-up"
      role="status"
      aria-live="polite"
      data-testid="scan-progress"
    >
      {/* 折叠态：单行进度 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 h-9 text-[12px] text-left hover:bg-bg-subtle/30 transition-colors"
        aria-expanded={expanded}
        aria-label={expanded ? '折叠扫描详情' : '展开扫描详情'}
      >
        <StatusIcon size={13} className={statusColor} />
        <span className={`font-medium ${statusColor}`}>{statusText}</span>

        {/* 进度条（accent 渐变） — flex-1 占据中间最大空间 */}
        <span className="flex-1 relative h-1 rounded-full bg-bg-subtle overflow-hidden">
          <span
            className={`absolute inset-y-0 left-0 ${barColor} transition-[width] duration-200 ease-out`}
            style={{ width: `${isComplete ? 100 : pct}%` }}
          />
        </span>

        {/* 百分比 + 本数 */}
        {isRunning && (
          <>
            <span className="tabular-nums text-fg-muted">{pct}%</span>
            <span className="hidden md:inline tabular-nums text-fg-subtle">
              {progress.albumsFound} 本
            </span>
          </>
        )}
        {!isRunning && (
          <span className="tabular-nums text-fg-subtle">
            {progress.albumsFound} 本 · {elapsedSec}s
          </span>
        )}

        {/* 折叠/展开 */}
        {expanded ? (
          <ChevronUpIcon size={12} className="text-fg-subtle" />
        ) : (
          <ChevronDownIcon size={12} className="text-fg-subtle" />
        )}

        {/* 取消按钮（独立 click 区域，避免和折叠冲突） */}
        {isRunning && onCancel && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onCancel()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onCancel()
              }
            }}
            className="ml-1 p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-subtle transition-colors cursor-pointer"
            title="取消扫描"
            aria-label="取消扫描"
          >
            <CloseIcon size={12} />
          </span>
        )}
      </button>

      {/* 展开态：详情 */}
      {expanded && (
        <div className="px-4 py-2 text-[11px] text-fg-muted border-t border-border-faint bg-bg-elevated/40">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              阶段{' '}
              <span className="text-fg">{phaseLabel}</span>
            </span>
            <span>
              已发现{' '}
              <span className="text-fg tabular-nums">
                {progress.albumsFound}
              </span>{' '}
              个文件夹
            </span>
            <span>
              耗时{' '}
              <span className="text-fg tabular-nums">{elapsedSec}s</span>
            </span>
            {isError && progress.error && (
              <span className="text-danger truncate max-w-[60ch]">
                {progress.error}
              </span>
            )}
          </div>
          {progress.currentPath && (
            <div
              className="truncate mt-1 text-fg-subtle font-mono"
              title={progress.currentPath}
            >
              <span className="text-fg-subtle/70 mr-1">↳</span>
              {progress.currentPath}
            </div>
          )}
          {!progress.currentPath && fileName && (
            <div className="truncate mt-1 text-fg-subtle">{fileName}</div>
          )}
        </div>
      )}
    </div>
  )
}
