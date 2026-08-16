import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { configApi, type ServerConfig, type ServerConfigPatch } from '../../api/config'
import { useUIStore } from '../../store/uiStore'
import { useLibraryStore } from '../../store/libraryStore'
import { fsApi } from '../../api/fs'
import { useDebounce } from '../../hooks/useDebounce'
import {
  CheckIcon,
  AlertIcon,
  RefreshIcon,
  RestartIcon,
  TrashIcon,
  PlusIcon,
} from '../common/Icon'

// 单个字段的保存状态。
type FieldStatus = 'idle' | 'saving' | 'saved' | 'error'

// 哪些字段改动后需要重启才生效。
const REQUIRES_RESTART = new Set(['host', 'port', 'staticDir'])

// 字段定义：标签、说明、是否重启字段、UI 类型。
// mediaRoots 是特例：用 MediaRootsField 组件单独渲染，不走通用 ConfigRow。
type FieldDef =
  | { key: Exclude<keyof ServerConfigPatch, 'mediaRoots'>; label: string; hint?: string; kind: 'text' }
  | { key: Exclude<keyof ServerConfigPatch, 'mediaRoots'>; label: string; hint?: string; kind: 'number'; min?: number; max?: number }
  | { key: Exclude<keyof ServerConfigPatch, 'mediaRoots'>; label: string; hint?: string; kind: 'boolean' }

const FIELDS: { section: string; defs: FieldDef[] }[] = [
  {
    section: '媒体库',
    defs: [
      { key: 'cacheDir', label: '缓存目录', hint: '存放缩略图 / 扫描结果 / 用户偏好', kind: 'text' },
    ],
  },
  {
    section: '缩略图',
    defs: [
      { key: 'thumbSizeW', label: '缩略图宽度', kind: 'number', min: 50, max: 2000 },
      { key: 'thumbSizeH', label: '缩略图高度', kind: 'number', min: 50, max: 2000 },
      { key: 'thumbCacheSize', label: 'LRU 缓存项数', hint: '内存中保留多少张已生成的缩略图', kind: 'number', min: 50, max: 5000 },
      { key: 'cacheMaxAgeDays', label: '缓存保留天数', hint: '超出后被清理', kind: 'number', min: 1, max: 365 },
    ],
  },
  {
    section: '网络',
    defs: [
      { key: 'host', label: '监听地址', hint: '修改后需要重启后端', kind: 'text' },
      { key: 'port', label: '监听端口', hint: '修改后需要重启后端', kind: 'number', min: 1, max: 65535 },
    ],
  },
  {
    section: '静态资源',
    defs: [
      { key: 'staticDir', label: '前端构建目录', hint: '修改后需要重启后端', kind: 'text' },
    ],
  },
  {
    section: '安全',
    defs: [
      { key: 'allowOsOpen', label: '允许在系统文件管理器中打开', hint: '仅建议在受信环境开启', kind: 'boolean' },
    ],
  },
]

// 每个 field 的当前保存状态；key 由 section+key 拼成。
type StatusMap = Record<string, FieldStatus>

export default function ServerConfigPanel() {
  const qc = useQueryClient()
  const pushToast = useUIStore((s) => s.pushToast)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)

  const { data, isLoading } = useQuery({
    queryKey: ['server-config'],
    queryFn: () => configApi.get(),
  })

  const [status, setStatus] = useState<StatusMap>({})
  const [mediaRootsDirty, setMediaRootsDirty] = useState(false)
  // 暂存用户输入：草稿，避免每次 onChange 都触发 PUT（输入体验更顺）
  const [draft, setDraft] = useState<ServerConfigPatch>({})
  const debouncedDraft = useDebounce(draft, 600)

  // 把 debounced 草稿 flush 到后端
  const firstFlush = useRef(true)
  useEffect(() => {
    if (firstFlush.current) {
      firstFlush.current = false
      return
    }
    const keys = Object.keys(debouncedDraft)
    if (keys.length === 0) return
    flush(debouncedDraft)
    setDraft({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedDraft])

  const update = useMutation({
    mutationFn: (patch: ServerConfigPatch) => configApi.update(patch),
    onMutate: (patch) => {
      const keys = Object.keys(patch)
      const next: StatusMap = { ...status }
      keys.forEach((k) => (next[k] = 'saving'))
      setStatus(next)
    },
    onSuccess: (resp, patch) => {
      const keys = Object.keys(patch)
      const next: StatusMap = { ...status }
      keys.forEach((k) => (next[k] = 'saved'))
      setStatus(next)
      qc.setQueryData(['server-config'], resp.config)

      // 标记 MediaRoots 变脏 → 提示用户重新扫描
      if (resp.mediaRootsChanged) {
        setMediaRootsDirty(true)
      }
      // allowOsOpen 变更后：让前端 fsCapabilities 立即跟上，
      // 否则 Album 详情 / 右键菜单的"在资源管理器中打开"按钮
      // 仍然显示 disabled 状态直到下次 App 启动。
      if (keys.includes('allowOsOpen')) {
        void fsApi.syncCapabilities()
      }
      // 重启字段提示
      const needRestart = resp.requiresRestart ?? []
      const changedRestart = needRestart.filter((f) => keys.includes(f))
      if (changedRestart.length > 0) {
        pushToast({
          kind: 'info',
          message: `${changedRestart.join(', ')} 修改后需要重启后端才能生效`,
          ttl: 4500,
        })
      }
    },
    onError: (err: unknown, patch) => {
      const keys = Object.keys(patch ?? {})
      const next: StatusMap = { ...status }
      keys.forEach((k) => (next[k] = 'error'))
      setStatus(next)
      const msg = err instanceof Error ? err.message : '保存失败'
      pushToast({ kind: 'error', message: msg })
    },
  })

  function flush(patch: ServerConfigPatch) {
    update.mutate(patch)
  }

  if (isLoading || !data) {
    return <div className="text-sm text-fg-muted">加载中…</div>
  }

  const fieldValue = (key: keyof ServerConfigPatch): string | number | boolean => {
    // draft 优先：用户正在编辑的字段实时反映，否则从后端返回的当前值读
    if (key in draft && draft[key] !== undefined) {
      return draft[key] as never
    }
    return (data as ServerConfig)[key as keyof ServerConfig] as never
  }

  return (
    <div className="space-y-6">
      {/* 媒体库 — 多根（独立渲染） */}
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-fg-muted font-medium mb-2 px-1">
          媒体库
        </div>
        <div className="bg-bg-elevated border border-border-faint rounded-md overflow-hidden">
          <MediaRootsField
            // 用 draft 中的 mediaRoots 覆盖 data（draft 是用户当前编辑状态）
            roots={draft.mediaRoots ?? data.mediaRoots}
            status={status['mediaRoots'] ?? 'idle'}
            onChange={(next) => {
              setDraft((d) => ({ ...d, mediaRoots: next }))
              setStatus((s) => (s['mediaRoots'] === 'saved' ? { ...s, mediaRoots: 'idle' } : s))
            }}
          />
        </div>
      </div>

      {FIELDS.map((group) => (
        <div key={group.section}>
          <div className="text-[11px] uppercase tracking-[0.18em] text-fg-muted font-medium mb-2 px-1">
            {group.section}
          </div>
          <div className="bg-bg-elevated border border-border-faint rounded-md divide-y divide-border-faint overflow-hidden">
            {group.defs.map((def) => {
              const statusKey = def.key
              const st = status[statusKey] ?? 'idle'
              const requiresRestart = REQUIRES_RESTART.has(def.key as string)
              return (
                <ConfigRow
                  key={def.key}
                  def={def}
                  value={fieldValue(def.key)}
                  status={st}
                  requiresRestart={requiresRestart}
                  onChange={(v) => {
                    // 每次输入只更新草稿；debounce 后再 flush
                    setDraft((d) => ({ ...d, [def.key]: v as never }))
                    // 立即清掉"已保存"状态
                    setStatus((s) => (s[statusKey] === 'saved' ? { ...s, [statusKey]: 'idle' } : s))
                  }}
                />
              )
            })}
          </div>
        </div>
      ))}

      {mediaRootsDirty && (
        <div className="bg-accent/5 border border-accent/30 rounded-md px-4 py-3 flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 text-fg">
            <RefreshIcon size={14} />
            <span>媒体根目录已变更,旧扫描结果已清空,建议重新扫描</span>
          </div>
          <button
            onClick={async () => {
              await loadFromBackend()
              setMediaRootsDirty(false)
              pushToast({ kind: 'success', message: '已触发重新扫描' })
            }}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-accent/40 text-accent hover:bg-accent/10 text-xs transition-colors"
          >
            <RefreshIcon size={11} />
            立即重新扫描
          </button>
        </div>
      )}

      <div className="text-xs text-fg-subtle leading-relaxed px-1">
        配置文件路径:<code className="font-mono text-fg-muted">{data.configPath}</code>
        ; 改完自动写回 YAML,无需手动保存。
      </div>
    </div>
  )
}

// ---- 多根字段（独立组件）----

function MediaRootsField({
  roots,
  status,
  onChange,
}: {
  roots: string[]
  status: FieldStatus
  onChange: (next: string[]) => void
}) {
  // 始终渲染一个空槽位（即使当前为空），方便用户添加第一个根
  const list = roots.length === 0 ? [''] : roots
  const updateAt = (i: number, v: string) => {
    const next = [...roots]
    if (i < next.length) {
      next[i] = v
    } else {
      // 空槽位：替换为新值
      next[0] = v
    }
    onChange(next)
  }
  const removeAt = (i: number) => {
    if (i >= roots.length) {
      // 当前是空槽位：直接清空
      onChange([])
      return
    }
    const next = [...roots]
    next.splice(i, 1)
    onChange(next)
  }
  const addEmpty = () => {
    onChange([...roots, ''])
  }
  return (
    <div className="px-4 py-3 text-sm space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-fg">图像根目录</span>
          <span className="text-xs text-fg-subtle mt-0.5">
            多个目录都会扫描;相册按"来源"分组,badge 显示来自哪个根
          </span>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="space-y-2">
        {list.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={v}
              onChange={(e) => updateAt(i, e.target.value)}
              placeholder="E:\照片 或 /home/user/pics"
              className="flex-1 bg-bg-subtle border border-border-faint rounded-md h-8 px-2.5 text-sm font-mono focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => removeAt(i)}
              disabled={roots.length <= 1}
              title={roots.length <= 1 ? '至少保留一个根目录' : '删除此根目录'}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border-faint text-fg-subtle hover:text-danger hover:border-danger/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-fg-subtle disabled:hover:border-border-faint"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addEmpty}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border-faint text-fg-muted hover:text-fg hover:border-border-strong text-xs transition-colors"
      >
        <PlusIcon size={12} />
        添加根目录
      </button>
    </div>
  )
}

// ---- 单个字段行 ----

function ConfigRow({
  def,
  value,
  status,
  requiresRestart,
  onChange,
}: {
  def: FieldDef
  value: string | number | boolean
  status: FieldStatus
  requiresRestart: boolean
  onChange: (v: string | number | boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <div className="flex flex-col min-w-0">
        <span className="text-fg flex items-center gap-2">
          {def.label}
          {requiresRestart && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-subtle border border-border-faint px-1.5 py-0.5 rounded">
              <RestartIcon size={10} />
              需重启
            </span>
          )}
        </span>
        {def.hint && <span className="text-xs text-fg-subtle mt-0.5">{def.hint}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {def.kind === 'text' && (
          <input
            type="text"
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="bg-bg-subtle border border-border-faint rounded-md h-8 px-2.5 text-sm font-mono w-72 max-w-[40vw] focus:outline-none focus:border-accent"
          />
        )}
        {def.kind === 'number' && (
          <input
            type="number"
            value={Number(value)}
            min={def.min}
            max={def.max}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) onChange(n)
            }}
            className="bg-bg-subtle border border-border-faint rounded-md h-8 px-2.5 text-sm font-mono w-24 text-right tabular-nums focus:outline-none focus:border-accent"
          />
        )}
        {def.kind === 'boolean' && <Toggle checked={Boolean(value)} onChange={onChange} />}
        <StatusBadge status={status} />
      </div>
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

function StatusBadge({ status }: { status: FieldStatus }) {
  if (status === 'idle') return <span className="w-4" />
  if (status === 'saving') {
    return (
      <span
        className="inline-block w-3 h-3 rounded-full border-2 border-fg-muted border-t-transparent animate-spin"
        aria-label="保存中"
      />
    )
  }
  if (status === 'saved') {
    return <CheckIcon size={14} className="text-accent" aria-label="已保存" />
  }
  return <AlertIcon size={14} className="text-danger" aria-label="保存失败" />
}
