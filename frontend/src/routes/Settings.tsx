import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { prefsApi } from '../api/prefs'
import { favoritesApi, historyApi } from '../api/prefs'
import ThemeSwitcher from '../components/common/ThemeSwitcher'
import { useUIStore } from '../store/uiStore'
import { useLibraryStore } from '../store/libraryStore'
import {
  RefreshIcon,
  TrashIcon,
  LibraryIcon,
} from '../components/common/Icon'

export default function Settings() {
  const { data, isLoading } = useQuery({ queryKey: ['prefs'], queryFn: () => prefsApi.get() })
  const qc = useQueryClient()
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const lastScanAt = useLibraryStore((s) => s.lastScanAt)
  const result = useLibraryStore((s) => s.result)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)

  const patchPrefs = useMutation({
    mutationFn: (p: Partial<Parameters<typeof prefsApi.patch>[0]>) => prefsApi.patch(p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prefs'] }),
  })

  const pruneFav = useMutation({
    mutationFn: () => favoritesApi.prune(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  })

  const clearHist = useMutation({
    mutationFn: () => historyApi.clear(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['history'] }),
  })

  if (isLoading || !data) {
    return <div className="p-6 text-fg-muted">加载中…</div>
  }

  return (
    <div className="px-6 lg:px-10 py-8 max-w-3xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight mb-2">设置</h1>
      <p className="text-sm text-fg-muted mb-8">个性化你的阅读体验</p>

      <Section title="外观" icon={<RefreshIcon size={14} />}>
        <Row label="主题">
          <ThemeSwitcher />
        </Row>
        <Row label="侧边栏">
          <button
            onClick={toggleSidebar}
            className="px-3 py-1 rounded-md border border-border hover:bg-bg-subtle text-sm"
          >
            {sidebarCollapsed ? '展开' : '折叠'}
          </button>
        </Row>
      </Section>

      <Section title="阅读" icon={<LibraryIcon size={14} />}>
        <Row label="自动切换下一本">
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
        <Row label="最近访问上限">
          <NumberInput
            value={data.maxRecent}
            min={1}
            max={50}
            onChange={(v) => patchPrefs.mutate({ maxRecent: v })}
          />
        </Row>
      </Section>

      <Section title="数据" icon={<LibraryIcon size={14} />}>
        <Row label="扫描缓存">
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-muted">
              {result
                ? `${result.albumCount} 本 · ${lastScanAt ? new Date(lastScanAt).toLocaleString() : ''}`
                : '尚未加载'}
            </span>
            <button
              onClick={() => loadFromBackend()}
              className="px-3 py-1 rounded-md border border-border hover:bg-bg-subtle text-xs inline-flex items-center gap-1.5"
            >
              <RefreshIcon size={12} />
              <span>刷新</span>
            </button>
          </div>
        </Row>
        <Row label="清理失效收藏">
          <button
            onClick={() => pruneFav.mutate()}
            className="px-3 py-1 rounded-md border border-border hover:bg-bg-subtle text-xs"
          >
            {pruneFav.isPending ? '清理中…' : '清理'}
          </button>
        </Row>
        <Row label="清空最近访问">
          <button
            onClick={() => clearHist.mutate()}
            className="px-3 py-1 rounded-md border border-border hover:bg-bg-subtle text-xs inline-flex items-center gap-1.5 text-danger"
          >
            <TrashIcon size={12} />
            <span>{clearHist.isPending ? '清空中…' : '清空'}</span>
          </button>
        </Row>
      </Section>

      <Section title="关于" icon={<LibraryIcon size={14} />}>
        <div className="text-sm text-fg-muted leading-relaxed">
          <div className="font-display text-base text-fg">Manga · 漫画阅读器</div>
          <div className="mt-1">Web 版 · v0.2.0</div>
          <div className="mt-3 text-xs text-fg-subtle">
            按 <kbd className="font-mono px-1.5 py-0.5 rounded border border-border">?</kbd>
            查看所有快捷键。
          </div>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-fg-muted">{icon}</span>}
        <h2 className="text-xs uppercase tracking-wider text-fg-muted font-medium">{title}</h2>
      </div>
      <div className="bg-bg-elevated border border-border rounded-md divide-y divide-border overflow-hidden">
        {children}
      </div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <span className="text-fg">{label}</span>
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
    <div className="inline-flex items-center border border-border rounded-md overflow-hidden">
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        className="px-2 py-1 text-fg-muted hover:bg-bg-subtle hover:text-fg"
      >
        −
      </button>
      <span className="px-3 py-1 text-sm tabular-nums min-w-[40px] text-center">{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        className="px-2 py-1 text-fg-muted hover:bg-bg-subtle hover:text-fg"
      >
        +
      </button>
    </div>
  )
}
