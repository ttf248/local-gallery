import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { scanApi } from '../../api/scan'
import { useScanSSE } from '../../hooks/useScanSSE'
import { useLibraryStore } from '../../store/libraryStore'
import { useUIStore } from '../../store/uiStore'
import { useSearchStore, type SortKey } from '../../store/searchStore'
import ThemeSwitcher from '../common/ThemeSwitcher'
import GlobalSearch from '../common/GlobalSearch'
import { ScanIcon, ChevronDownIcon, GridIcon, ListIcon, HelpIcon } from '../common/Icon'

const sortOptions: { value: SortKey; label: string }[] = [
  { value: 'name', label: '按名称' },
  { value: 'count', label: '按张数' },
  { value: 'recent', label: '按修改时间' },
]

// 顶部工具栏：左侧标题区、中间搜索、右侧操作。
// 设计：克制的元素，仅在必要时显示。搜索栏与标题共存。
export default function Toolbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const sse = useScanSSE()
  const setResult = useLibraryStore((s) => s.setResult)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)
  const pushToast = useUIStore((s) => s.pushToast)
  const viewMode = useUIStore((s) => s.viewMode)
  const setViewMode = useUIStore((s) => s.setViewMode)
  const sortBy = useSearchStore((s) => s.sortBy)
  const setSortBy = useSearchStore((s) => s.setSortBy)

  const onViewer = location.pathname.startsWith('/viewer')
  const onHome = location.pathname === '/' || location.pathname === ''
  const onCollection = location.pathname.startsWith('/albums')

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
        pushToast({ kind: 'success', message: `扫描完成 · 共 ${r.result.albumCount} 本` })
      })
      .catch(() => pushToast({ kind: 'error', message: '获取扫描结果失败' }))
  }, [sse.isComplete, sse.scanId, setResult, pushToast])

  return (
    <header className="h-14 flex items-center gap-3 px-4 lg:px-6 border-b border-border-faint bg-bg-elevated/60 backdrop-blur-sm">
      {/* 标题（窄屏隐藏） */}
      <div className="hidden lg:flex items-center gap-2 mr-1 min-w-[200px]">
        <span className="text-sm text-fg-muted">Manga</span>
        <span className="text-fg-subtle">/</span>
        <span className="text-sm font-medium">{titleOf(location.pathname)}</span>
      </div>

      {!onViewer && (
        <div className="flex-1 max-w-xl">
          <GlobalSearch />
        </div>
      )}
      {onViewer && <div className="flex-1" />}

      <div className="flex items-center gap-1.5">
        {/* 排序 + 视图切换（仅在主页 / 集合页可见） */}
        {(onHome || onCollection) && (
          <>
            <SortMenu value={sortBy} onChange={setSortBy} />
            <div className="flex items-center border border-border-faint rounded-md overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-bg-subtle text-fg'
                    : 'text-fg-subtle hover:text-fg'
                }`}
                title="网格视图"
                aria-label="网格视图"
              >
                <GridIcon size={14} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 transition-colors ${
                  viewMode === 'list'
                    ? 'bg-bg-subtle text-fg'
                    : 'text-fg-subtle hover:text-fg'
                }`}
                title="列表视图"
                aria-label="列表视图"
              >
                <ListIcon size={14} />
              </button>
            </div>
            <div className="w-px h-5 bg-border-faint mx-1" />
          </>
        )}

        {!onViewer && (
          <button
            onClick={() => loadFromBackend()}
            className="text-xs px-2.5 h-8 rounded-md text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
            title="刷新缓存"
          >
            刷新
          </button>
        )}
        {!onViewer && (
          <button
            onClick={() => startScan.mutate()}
            disabled={startScan.isPending || sse.isRunning}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs bg-accent text-accent-fg hover:bg-accent-hover transition-colors disabled:opacity-50"
            title="扫描 (Ctrl+S)"
          >
            <ScanIcon size={12} />
            <span>{sse.isRunning ? '扫描中' : '扫描'}</span>
          </button>
        )}
        {!onViewer && (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('comic:open-help'))}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
            title="快捷键帮助 (?)"
            aria-label="快捷键帮助"
          >
            <HelpIcon size={14} />
          </button>
        )}
        {onViewer && (
          <button
            onClick={() => navigate(-1)}
            className="text-xs h-8 px-3 rounded-md text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
          >
            返回
          </button>
        )}
        <ThemeSwitcher compact />
      </div>
    </header>
  )
}

function titleOf(pathname: string): string {
  if (pathname === '/' || pathname === '') return '漫画库'
  if (pathname.startsWith('/recents')) return '最近'
  if (pathname.startsWith('/favorites')) return '收藏'
  if (pathname.startsWith('/settings')) return '设置'
  if (pathname.startsWith('/albums')) return '相册'
  if (pathname.startsWith('/viewer')) return '阅读'
  return '漫画'
}

function SortMenu({
  value,
  onChange,
}: {
  value: SortKey
  onChange: (v: SortKey) => void
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

  const cur = sortOptions.find((o) => o.value === value) ?? sortOptions[0]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
        title="排序"
      >
        <span>{cur.label}</span>
        <ChevronDownIcon size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 min-w-[140px] bg-bg-elevated border border-border rounded-md shadow-md py-1 z-40 fade-up">
          {sortOptions.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                o.value === value
                  ? 'text-fg font-medium'
                  : 'text-fg-muted hover:bg-bg-subtle hover:text-fg'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
