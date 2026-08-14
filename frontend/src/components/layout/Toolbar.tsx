import { useMutation } from '@tanstack/react-query'
import { scanApi } from '../../api/scan'

export default function Toolbar() {
  const startScan = useMutation({
    mutationFn: () => scanApi.start(),
  })

  return (
    <header className="h-12 flex items-center gap-2 px-3 border-b border-border bg-bg-elevated">
      <button
        onClick={() => startScan.mutate()}
        disabled={startScan.isPending}
        className="px-3 py-1.5 rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {startScan.isPending ? '扫描中…' : '扫描'}
      </button>
      <button
        onClick={() => window.location.reload()}
        className="px-3 py-1.5 rounded text-fg-muted hover:bg-bg-subtle hover:text-fg"
      >
        刷新
      </button>
      <div className="flex-1" />
      <span className="text-xs text-fg-subtle">
        F5 刷新 · Ctrl+/ 帮助
      </span>
    </header>
  )
}
