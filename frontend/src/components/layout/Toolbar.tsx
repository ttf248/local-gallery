import { useMutation } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { scanApi } from '../../api/scan'
import { useScanSSE } from '../../hooks/useScanSSE'
import { useLibraryStore } from '../../store/libraryStore'
import ThemeSwitcher from '../common/ThemeSwitcher'
import GlobalSearch from '../common/GlobalSearch'
import { useUIStore } from '../../store/uiStore'
import { ScanIcon, RefreshIcon } from '../common/Icon'

export default function Toolbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const sse = useScanSSE()
  const setResult = useLibraryStore((s) => s.setResult)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)

  // 监听全局 / 快捷键：Ctrl+S 触发扫描
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        startScan.mutate()
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startScan = useMutation({
    mutationFn: () => scanApi.start(),
    onSuccess: (r) => {
      sse.startWith(r.scanId)
    },
  })

  // 扫描完成后写入缓存
  useEffect(() => {
    if (!sse.isComplete || !sse.scanId) return
    scanApi
      .result(sse.scanId)
      .then((r) => setResult(r.result))
      .catch(() => {})
  }, [sse.isComplete, sse.scanId, setResult])

  const onViewer = location.pathname.startsWith('/viewer')

  return (
    <header className="h-14 flex items-center gap-3 px-4 border-b border-border bg-bg-elevated">
      {/* 折叠按钮（仅桌面端） */}
      <button
        onClick={toggleSidebar}
        className="hidden md:inline-flex items-center justify-center p-1.5 rounded text-fg-muted hover:bg-bg-subtle hover:text-fg"
        title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
      >
        <RefreshIcon size={16} className="rotate-180" />
      </button>

      {/* 搜索栏（查看器页隐藏） */}
      {!onViewer && (
        <div className="flex-1 max-w-xl">
          <GlobalSearch />
        </div>
      )}
      {onViewer && <div className="flex-1" />}

      <div className="flex items-center gap-1.5">
        {!onViewer && (
          <>
            <button
              onClick={() => {
                loadFromBackend()
              }}
              className="px-2.5 py-1.5 rounded-md text-xs text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
              title="刷新"
            >
              <RefreshIcon size={14} />
            </button>
            <button
              onClick={() => startScan.mutate()}
              disabled={startScan.isPending || sse.isRunning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-accent text-accent-fg hover:bg-accent-hover transition-colors disabled:opacity-50"
              title="扫描 (Ctrl+S)"
            >
              <ScanIcon size={13} />
              <span>{sse.isRunning ? '扫描中' : '扫描'}</span>
            </button>
          </>
        )}
        {onViewer && (
          <button
            onClick={() => navigate(-1)}
            className="px-3 py-1.5 rounded-md text-xs text-fg-muted hover:bg-bg-subtle hover:text-fg"
          >
            返回
          </button>
        )}
        <ThemeSwitcher compact />
      </div>
    </header>
  )
}
