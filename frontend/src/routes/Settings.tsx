import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { prefsApi, favoritesApi, historyApi } from '../api/prefs'
import { scanApi } from '../api/scan'
import { cacheApi, formatBytes } from '../api/cache'
import { useScanSSE } from '../hooks/useScanSSE'
import ThemeSwitcher from '../components/common/ThemeSwitcher'
import { useUIStore, type AccentKey } from '../store/uiStore'
import { useLibraryStore } from '../store/libraryStore'
import { ACCENT_SWATCHES } from '../hooks/useTheme'
import { useTheme } from '../hooks/useTheme'
import ServerConfigPanel from '../components/settings/ServerConfigPanel'
import {
  RefreshIcon,
  TrashIcon,
  LibraryIcon,
  SunIcon,
  KeyboardIcon,
  InfoIcon,
  CheckIcon,
  ServerIcon,
} from '../components/common/Icon'

export default function Settings() {
  const { data, isLoading } = useQuery({ queryKey: ['prefs'], queryFn: () => prefsApi.get() })
  const qc = useQueryClient()
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const viewMode = useUIStore((s) => s.viewMode)
  const setViewMode = useUIStore((s) => s.setViewMode)
  const accent = useUIStore((s) => s.accent)
  const setAccent = useUIStore((s) => s.setAccent)
  const pushToast = useUIStore((s) => s.pushToast)
  const lastScanAt = useLibraryStore((s) => s.lastScanAt)
  const result = useLibraryStore((s) => s.result)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)
  const setResult = useLibraryStore((s) => s.setResult)
  const sse = useScanSSE()
  useTheme()

  // 缓存占用统计(后端 30s TTL,前端 staleTime 设小一点保证手动刷新能即时看到)
  const cacheStats = useQuery({
    queryKey: ['cache-stats'],
    queryFn: () => cacheApi.stats(),
    staleTime: 5_000,
  })
  function refreshCacheStats() {
    cacheStats.refetch()
  }

  const patchPrefs = useMutation({
    mutationFn: (p: Partial<Parameters<typeof prefsApi.patch>[0]>) => prefsApi.patch(p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prefs'] }),
  })

  const pruneFav = useMutation({
    mutationFn: () => favoritesApi.prune(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['favorites'] })
      pushToast({ kind: 'success', message: `已清理 ${r.removed.length} 项失效收藏` })
    },
  })

  const clearHist = useMutation({
    mutationFn: () => historyApi.clear(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['history'] })
      pushToast({ kind: 'success', message: '已清空最近访问' })
    },
  })

  // Settings 页内也能触发扫描：与 Home / Toolbar 走同一套 SSE。
  const startScan = useMutation({
    mutationFn: () => scanApi.start(),
    onSuccess: (r) => {
      sse.startWith(r.scanId)
      pushToast({ kind: 'info', message: '扫描已开始' })
    },
    onError: () => pushToast({ kind: 'error', message: '启动扫描失败' }),
  })
  // 扫描完成时把结果写回 store
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

  if (isLoading || !data) {
    return <div className="p-10 text-fg-muted text-sm">加载中…</div>
  }

  return (
    <div className="px-6 lg:px-10 py-10 max-w-3xl mx-auto w-full">
      <h1 className="font-display text-[32px] font-semibold tracking-[-0.02em]">设置</h1>
      <p className="text-sm text-fg-muted mt-2 mb-10">个性化你的阅读体验</p>

      <Section title="外观" icon={<SunIcon size={13} />}>
        <Row label="主题">
          <ThemeSwitcher />
        </Row>
        <Row label="强调色">
          <div className="flex items-center gap-2">
            {ACCENT_SWATCHES.map((s) => {
              const active = accent === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => setAccent(s.id as AccentKey)}
                  className="relative w-7 h-7 rounded-full transition-transform hover:scale-110 focus:outline-none"
                  style={{ background: s.light }}
                  title={s.name}
                  aria-label={s.name}
                >
                  {active && (
                    <span className="absolute inset-0 ring-2 ring-fg ring-offset-2 ring-offset-bg-elevated rounded-full flex items-center justify-center">
                      <CheckIcon size={12} className="text-fg" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </Row>
        <Row label="侧边栏">
          <button
            onClick={toggleSidebar}
            className="px-3 h-8 rounded-md border border-border-faint hover:bg-bg-subtle text-sm transition-colors"
          >
            {sidebarCollapsed ? '展开' : '折叠'}
          </button>
        </Row>
        <Row label="默认视图">
          <div className="flex items-center border border-border-faint rounded-md overflow-hidden">
            {(['grid', 'list'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setViewMode(k)}
                className={`h-8 px-3 text-xs transition-colors ${
                  viewMode === k
                    ? 'bg-bg-subtle text-fg'
                    : 'text-fg-muted hover:text-fg'
                }`}
              >
                {k === 'grid' ? '网格' : '列表'}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="阅读" icon={<LibraryIcon size={13} />}>
        <Row label="阅读到末尾自动切换下一本">
          <Toggle
            checked={data.autoSwitchAlbum}
            onChange={(v) => patchPrefs.mutate({ autoSwitchAlbum: v })}
          />
        </Row>
        <Row label="切换时显示通知">
          <Toggle
            checked={data.showSwitchNotif}
            onChange={(v) => patchPrefs.mutate({ showSwitchNotif: v })}
          />
        </Row>
        <Row label="最近访问保留条数">
          <NumberInput
            value={data.maxRecent}
            min={1}
            max={50}
            onChange={(v) => patchPrefs.mutate({ maxRecent: v })}
          />
        </Row>
      </Section>

      <Section title="数据" icon={<LibraryIcon size={13} />}>
        <Row label="图像库缓存">
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-muted">
              {result
                ? `${result.albumCount} 文件夹 · ${(result.smartCollections ?? []).length} 标签${
                    lastScanAt
                      ? ` · ${new Date(lastScanAt).toLocaleString('zh-CN', { hour12: false })}`
                      : ' · 尚未扫描'
                  }`
                : '尚未加载'}
            </span>
            <button
              onClick={() => loadFromBackend()}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border-faint hover:bg-bg-subtle text-xs transition-colors"
            >
              <RefreshIcon size={11} />
              <span>刷新</span>
            </button>
            <button
              onClick={() => startScan.mutate()}
              disabled={startScan.isPending || sse.isRunning}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border-faint hover:bg-bg-subtle text-xs transition-colors disabled:opacity-50"
              title="扫描 (Ctrl+S)"
            >
              <RefreshIcon size={11} />
              <span>{sse.isRunning ? '扫描中…' : startScan.isPending ? '启动中…' : '重新扫描'}</span>
            </button>
          </div>
        </Row>
        <Row label="缓存占用">
          <div className="flex items-center gap-3 text-xs text-fg-muted">
            <span>
              {cacheStats.isLoading
                ? '计算中…'
                : !cacheStats.data
                ? '—'
                : !cacheStats.data.available
                ? '不可用'
                : `${formatBytes(cacheStats.data.totalBytes)} · ${
                    cacheStats.data.fileCount
                  } 个文件`}
            </span>
            {cacheStats.data && (
              <span
                className="text-fg-subtle/70 tabular-nums"
                title={
                  cacheStats.data.scannedAt
                    ? `扫描于 ${new Date(cacheStats.data.scannedAt).toLocaleString('zh-CN', { hour12: false })}`
                    : ''
                }
              >
                {cacheStats.data.cacheTtlSeconds > 0
                  ? `${cacheStats.data.cacheTtlSeconds}s 内复用`
                  : '缓存已过期'}
              </span>
            )}
            <button
              onClick={refreshCacheStats}
              disabled={cacheStats.isFetching}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border-faint hover:bg-bg-subtle text-xs transition-colors disabled:opacity-50"
              title="重新扫描磁盘计算缓存占用"
            >
              {cacheStats.isFetching ? (
                <span className="inline-block w-3 h-3 rounded-full border-2 border-fg-muted border-t-transparent animate-spin" />
              ) : (
                <RefreshIcon size={11} />
              )}
              <span>刷新</span>
            </button>
          </div>
        </Row>
        <Row label="清理失效收藏">
          <button
            onClick={() => pruneFav.mutate()}
            className="h-8 px-3 rounded-md border border-border-faint hover:bg-bg-subtle text-xs transition-colors"
          >
            {pruneFav.isPending ? '清理中…' : '清理'}
          </button>
        </Row>
        <Row label="清空最近访问" danger>
          <button
            onClick={() => clearHist.mutate()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-danger/40 text-danger hover:bg-danger/5 text-xs transition-colors"
          >
            <TrashIcon size={11} />
            <span>{clearHist.isPending ? '清空中…' : '清空'}</span>
          </button>
        </Row>
      </Section>

      <section className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-fg-muted">
            <ServerIcon size={13} />
          </span>
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-fg-muted font-medium">
            服务端
          </h2>
          <span className="text-[10px] text-fg-subtle ml-2">
            改动自动写回后端 config.yaml
          </span>
        </div>
        <ServerConfigPanel />
      </section>

      <Section title="关于" icon={<InfoIcon size={13} />}>
        <div className="text-sm text-fg-muted leading-relaxed">
          <div className="font-display text-base text-fg">Viewer · 图像浏览器</div>
          <div className="mt-1">Web 版 · v{__APP_VERSION__}</div>
          <div className="mt-4 text-xs text-fg-subtle flex items-center gap-2">
            <span>按</span>
            <kbd className="font-mono px-1.5 py-0.5 rounded border border-border-faint bg-bg-subtle">?</kbd>
            <span>查看所有快捷键</span>
          </div>
          <div className="mt-3 text-xs text-fg-subtle flex items-center gap-2">
            <KeyboardIcon size={12} />
            <span>所有偏好（主题、强调色、视图、收藏）均存于本机</span>
          </div>
        </div>
      </Section>
    </div>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-fg-muted">{icon}</span>}
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-fg-muted font-medium">
          {title}
        </h2>
      </div>
      <div className="bg-bg-elevated border border-border-faint rounded-md divide-y divide-border-faint overflow-hidden">
        {children}
      </div>
    </section>
  )
}

function Row({
  label,
  children,
  danger,
}: {
  label: string
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <span className={danger ? 'text-danger' : 'text-fg'}>{label}</span>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-bg-strong'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-bg-elevated rounded-full shadow transition-transform ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  )
}

function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="inline-flex items-center border border-border-faint rounded-md overflow-hidden">
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-8 h-8 text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
      >
        −
      </button>
      <span className="px-3 h-8 inline-flex items-center text-sm tabular-nums min-w-[40px] justify-center">
        {value}
      </span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-8 h-8 text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
      >
        +
      </button>
    </div>
  )
}
