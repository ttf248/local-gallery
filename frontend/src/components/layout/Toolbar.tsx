import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { scanApi } from '../../api/scan'
import { useScanSSE } from '../../hooks/useScanSSE'
import { useLibraryStore } from '../../store/libraryStore'
import { useUIStore } from '../../store/uiStore'
import ThemeSwitcher from '../common/ThemeSwitcher'
import GlobalSearch from '../common/GlobalSearch'
import { ScanIcon, MoreHorizontalIcon, RefreshIcon, HelpIcon } from '../common/Icon'

// 顶部工具栏（精简后）：
//   左侧：极简字标
//   中部：全局搜索
//   右侧：主题 / 帮助 / 更多(扫描 + 刷新缓存)
//
// 排序 / 视图模式 / 视图 chips 已迁移到各 list 页面的 filter strip,
//  让 toolbar 只承担"全局信息 + 主题"职责,避免挤 7+ 控件。
export default function Toolbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const sse = useScanSSE()
  const setResult = useLibraryStore((s) => s.setResult)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)
  const pushToast = useUIStore((s) => s.pushToast)

  const onViewer = location.pathname.startsWith('/viewer')

  // Ctrl+S 全局触发扫描
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
      pushToast({ kind: 'info', message: '扫描已开始' })
    },
    onError: () => pushToast({ kind: 'error', message: '启动扫描失败' }),
  })

  useEffect(() => {
    if (!sse.isComplete || !sse.scanId) return
    scanApi
      .result(sse.scanId)
      .then((r) => {
        setResult(r.result)
        pushToast({ kind: 'success', message: `扫描完成 · 共 ${r.result.albumCount} 个文件夹` })
      })
      .catch(() => pushToast({ kind: 'error', message: '获取扫描结果失败' }))
  }, [sse.isComplete, sse.scanId, setResult, pushToast])

  return (
    <header className="h-14 flex items-center gap-4 px-5 lg:px-7 border-b border-border-faint glass">
      {/* 左侧：极简字标（窄屏隐藏） */}
      <div className="hidden lg:flex items-center gap-2 min-w-0">
        <span className="font-display text-sm text-fg-muted">Viewer</span>
        <span className="text-fg-subtle/50">/</span>
        <span className="text-sm font-medium truncate">{titleOf(location.pathname)}</span>
      </div>
      {/* 窄屏：返回按钮 */}
      <div className="lg:hidden">
        {onViewer ? (
          <button
            onClick={() => navigate(-1)}
            className="text-xs h-8 px-2.5 rounded-md text-fg-muted hover:bg-bg-subtle"
          >
            返回
          </button>
        ) : null}
      </div>

      {!onViewer && (
        <div className="flex-1 max-w-[560px]">
          <GlobalSearch />
        </div>
      )}
      {onViewer && <div className="flex-1" />}

      <div className="flex items-center gap-1">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('comic:open-help'))}
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
          title="快捷键帮助 (?)"
          aria-label="快捷键帮助"
        >
          <HelpIcon size={14} />
        </button>
        <ThemeSwitcher compact />
        {!onViewer && <MoreMenu onScan={() => startScan.mutate()} onRefresh={() => loadFromBackend()} scanPending={startScan.isPending || sse.isRunning} />}
      </div>
    </header>
  )
}

function titleOf(pathname: string): string {
  if (pathname === '/' || pathname === '') return '图像库'
  if (pathname.startsWith('/recents')) return '最近'
  if (pathname.startsWith('/favorites')) return '收藏'
  if (pathname.startsWith('/settings')) return '设置'
  if (pathname.startsWith('/albums')) return '文件夹'
  if (pathname.startsWith('/viewer')) return '浏览'
  return '图像'
}

// kebab 菜单: 扫描 + 刷新缓存
// 收纳了原来 toolbar 上两个独立的次级按钮,让 toolbar 更克制。
function MoreMenu({
  onScan,
  onRefresh,
  scanPending,
}: {
  onScan: () => void
  onRefresh: () => void
  scanPending: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    setTimeout(() => {
      window.addEventListener('mousedown', onClick)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
        title="更多"
        aria-label="更多"
      >
        <MoreHorizontalIcon size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 min-w-[180px] bg-bg-elevated border border-border rounded-lg shadow-lg py-1 z-40 fade-up">
          <button
            onClick={() => {
              setOpen(false)
              onScan()
            }}
            disabled={scanPending}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors disabled:opacity-50"
          >
            <ScanIcon size={12} />
            <span>{scanPending ? '扫描中…' : '重新扫描'}</span>
            <span className="ml-auto text-[10px] text-fg-subtle font-mono">Ctrl+S</span>
          </button>
          <button
            onClick={() => {
              setOpen(false)
              onRefresh()
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
          >
            <RefreshIcon size={12} />
            <span>刷新缓存</span>
          </button>
        </div>
      )}
    </div>
  )
}
