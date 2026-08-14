import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { prefsApi, favoritesApi, historyApi } from '../api/prefs'
import ThemeSwitcher from '../components/common/ThemeSwitcher'
import { useUIStore } from '../store/uiStore'
import { useLibraryStore } from '../store/libraryStore'
import {
  RefreshIcon,
  TrashIcon,
  LibraryIcon,
  SunIcon,
  KeyboardIcon,
} from '../components/common/Icon'

export default function Settings() {
  const { data, isLoading } = useQuery({ queryKey: ['prefs'], queryFn: () => prefsApi.get() })
  const qc = useQueryClient()
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const viewMode = useUIStore((s) => s.viewMode)
  const setViewMode = useUIStore((s) => s.setViewMode)
  const pushToast = useUIStore((s) => s.pushToast)
  const lastScanAt = useLibraryStore((s) => s.lastScanAt)
  const result = useLibraryStore((s) => s.result)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)

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

  if (isLoading || !data) {
    return <div className="p-10 text-fg-muted text-sm">加载中…</div>
  }

  return (
    <div className="px-6 lg:px-10 py-10 max-w-3xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight mb-1">设置</h1>
      <p className="text-sm text-fg-muted mb-10">个性化你的阅读体验</p>

      <Section title="外观" icon={<SunIcon size={13} />}>
        <Row label="主题">
          <ThemeSwitcher />
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
        <Row label="漫画库缓存">
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-muted">
              {result
                ? `${result.albumCount} 本 · ${lastScanAt ? new Date(lastScanAt).toLocaleString('zh-CN', { hour12: false }) : '尚未扫描'}`
                : '尚未加载'}
            </span>
            <button
              onClick={() => loadFromBackend()}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border-faint hover:bg-bg-subtle text-xs transition-colors"
            >
              <RefreshIcon size={11} />
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

      <Section title="关于" icon={<KeyboardIcon size={13} />}>
        <div className="text-sm text-fg-muted leading-relaxed">
          <div className="font-display text-base text-fg">Manga · 漫画阅读器</div>
          <div className="mt-1">Web 版 · v0.2.0</div>
          <div className="mt-4 text-xs text-fg-subtle flex items-center gap-2">
            <span>按</span>
            <kbd className="font-mono px-1.5 py-0.5 rounded border border-border-faint bg-bg-subtle">?</kbd>
            <span>查看所有快捷键</span>
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
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-fg-muted font-medium">
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
