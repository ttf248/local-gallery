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
  FolderOpenIcon,
  FolderSearchIcon,
} from '../common/Icon'

// 单个字段的保存状态。
type FieldStatus = 'idle' | 'saving' | 'saved' | 'error'

// 哪些字段改动后需要重启才生效。
const REQUIRES_RESTART = new Set(['host', 'port', 'staticDir'])

// 哪些字段是路径类（用 onBlur 自动保存,不用 debounce）。
// 理由:路径输错一个字符就触发保存体验差;按 Enter / 离开输入框再保存更稳。
const PATH_FIELDS = new Set(['mediaRoots', 'cacheDir', 'staticDir'])

// 字段定义:标签、说明、是否重启字段、UI 类型。
// mediaRoots 是特例:用 MediaRootsField 组件单独渲染,不走通用 ConfigRow。
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

// 每个 field 的当前保存状态;key 由 section+key 拼成。
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
  // 暂存用户输入:草稿,避免每次 onChange 都触发 PUT(输入体验更顺)
  const [draft, setDraft] = useState<ServerConfigPatch>({})
  // 路径类字段用 onBlur 触发(不走 debounce);非路径类才用 debounce
  const debouncedDraft = useDebounce(draft, 600)
  // 当前"路径类草稿"按字段拆,onBlur 时取对应字段提交
  const pathDirtyRef = useRef<Partial<Record<keyof ServerConfigPatch, any>>>({})

  // 把 debounced 草稿 flush 到后端(仅限非路径类字段)
  const firstFlush = useRef(true)
  useEffect(() => {
    if (firstFlush.current) {
      firstFlush.current = false
      return
    }
    const keys = Object.keys(debouncedDraft)
    if (keys.length === 0) return
    // 过滤掉路径类(它们已通过 onBlur 单独提交)
    const nonPathKeys = keys.filter((k) => !PATH_FIELDS.has(k))
    if (nonPathKeys.length === 0) {
      setDraft((d) => {
        const next = { ...d }
        nonPathKeys.forEach((k) => delete next[k as keyof ServerConfigPatch])
        return next
      })
      return
    }
    const payload: ServerConfigPatch = {}
    nonPathKeys.forEach((k) => {
      ;(payload as any)[k] = (debouncedDraft as any)[k]
    })
    flush(payload)
    // 清掉已 flush 的字段
    setDraft((d) => {
      const next = { ...d }
      nonPathKeys.forEach((k) => delete next[k as keyof ServerConfigPatch])
      return next
    })
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
      // allowOsOpen 变更后:让前端 fsCapabilities 立即跟上,
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
      // saved 状态 1.5s 后自动清回 idle,避免永久显示"已保存"
      keys.forEach((k) => {
        setTimeout(() => {
          setStatus((s) => (s[k] === 'saved' ? { ...s, [k]: 'idle' } : s))
        }, 1500)
      })
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

  // 路径类字段保存:onBlur 时调用
  function flushPathField(key: keyof ServerConfigPatch) {
    const v = pathDirtyRef.current[key]
    if (v === undefined) return
    delete pathDirtyRef.current[key]
    setDraft((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
    flush({ [key]: v } as ServerConfigPatch)
  }

  if (isLoading || !data) {
    return <div className="text-sm text-fg-muted">加载中…</div>
  }

  const fieldValue = (key: keyof ServerConfigPatch): string | number | boolean => {
    // draft 优先:用户正在编辑的字段实时反映,否则从后端返回的当前值读
    if (key in draft && draft[key] !== undefined) {
      return draft[key] as never
    }
    return (data as ServerConfig)[key as keyof ServerConfig] as never
  }

  return (
    <div className="space-y-6">
      {/* 媒体库 — 多根(独立渲染) */}
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-fg-muted font-medium mb-2 px-1">
          媒体库
        </div>
        <div className="bg-bg-elevated border border-border-faint rounded-md overflow-hidden">
          <MediaRootsField
            // 用 draft 中的 mediaRoots 覆盖 data(draft 是用户当前编辑状态)
            roots={draft.mediaRoots ?? data.mediaRoots}
            status={status['mediaRoots'] ?? 'idle'}
            allowOsOpen={data.allowOsOpen}
            onChange={(next) => {
              setDraft((d) => ({ ...d, mediaRoots: next }))
              pathDirtyRef.current.mediaRoots = next
              setStatus((s) => (s['mediaRoots'] === 'saved' ? { ...s, mediaRoots: 'idle' } : s))
            }}
            onCommit={() => flushPathField('mediaRoots')}
            onOpenInExplorer={openMediaRoot}
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
              const isPath = PATH_FIELDS.has(def.key as string)
              return (
                <ConfigRow
                  key={def.key}
                  def={def}
                  value={fieldValue(def.key)}
                  status={st}
                  requiresRestart={requiresRestart}
                  isPath={isPath}
                  allowOsOpen={data.allowOsOpen}
                  onChange={(v) => {
                    // 每次输入只更新草稿;非路径字段 debounce 后再 flush,
                    // 路径字段由 onBlur 触发 flush
                    setDraft((d) => ({ ...d, [def.key]: v as never }))
                    if (isPath) {
                      pathDirtyRef.current[def.key] = v
                      setStatus((s) => (s[statusKey] === 'saved' ? { ...s, [statusKey]: 'idle' } : s))
                    } else {
                      setStatus((s) => (s[statusKey] === 'saved' ? { ...s, [statusKey]: 'idle' } : s))
                    }
                  }}
                  onCommit={isPath ? () => flushPathField(def.key) : undefined}
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

// 媒体根打开资源管理器的统一处理(带错误 toast)
async function openMediaRoot(path: string): Promise<void> {
  const ui = useUIStore.getState()
  try {
    await fsApi.openInExplorer(path)
  } catch (e: any) {
    const msg = e?.message ?? '打开失败'
    if (msg.includes('403') || msg.includes('disabled')) {
      ui.pushToast({ kind: 'warning', message: '请先在「安全」里开启「允许在系统文件管理器中打开」' })
    } else {
      ui.pushToast({ kind: 'error', message: '打开失败:' + msg })
    }
  }
}

// ---- 多根字段(独立组件)----

function MediaRootsField({
  roots,
  status,
  allowOsOpen,
  onChange,
  onCommit,
  onOpenInExplorer,
}: {
  roots: string[]
  status: FieldStatus
  allowOsOpen: boolean
  onChange: (next: string[]) => void
  onCommit: () => void
  onOpenInExplorer: (path: string) => void
}) {
  // 始终渲染一个空槽位(即使当前为空),方便用户添加第一个根
  const list = roots.length === 0 ? [''] : roots
  const updateAt = (i: number, v: string) => {
    const next = [...roots]
    if (i < next.length) {
      next[i] = v
    } else {
      // 空槽位:替换为新值
      next[0] = v
    }
    onChange(next)
  }
  const removeAt = (i: number) => {
    if (i >= roots.length) {
      // 当前是空槽位:直接清空
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
          <PathField
            key={i}
            value={v}
            placeholder="E:\照片 或 /home/user/pics"
            // 只在已存在的根上提供"打开资源管理器"(空槽位不算)
            onOpenInExplorer={
              i < roots.length && v && allowOsOpen
                ? () => onOpenInExplorer(v)
                : undefined
            }
            onPick={(picked) => updateAt(i, picked)}
            onChange={(nv) => updateAt(i, nv)}
            onCommit={onCommit}
            removable={roots.length > 1}
            onRemove={() => removeAt(i)}
          />
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
  isPath,
  allowOsOpen,
  onChange,
  onCommit,
}: {
  def: FieldDef
  value: string | number | boolean
  status: FieldStatus
  requiresRestart: boolean
  isPath: boolean
  allowOsOpen: boolean
  onChange: (v: string | number | boolean) => void
  onCommit?: () => void
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
        {def.kind === 'text' && isPath ? (
          <PathField
            value={String(value)}
            placeholder={def.hint ?? '路径'}
            onChange={(v) => onChange(v)}
            onCommit={onCommit}
            onOpenInExplorer={
              value && String(value).length > 0 && allowOsOpen
                ? () => openConfigPath(String(value), def.key as string)
                : undefined
            }
            onPick={(picked) => onChange(picked)}
            compact
            withStatus
            status={status}
          />
        ) : def.kind === 'text' ? (
          <input
            type="text"
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="bg-bg-subtle border border-border-faint rounded-md h-8 px-2.5 text-sm font-mono w-72 max-w-[40vw] focus:outline-none focus:border-accent"
          />
        ) : def.kind === 'number' ? (
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
        ) : (
          <Toggle checked={Boolean(value)} onChange={onChange} />
        )}
        {/* 状态指示:只在非路径/非紧凑模式单独显示(紧凑模式由 PathField 内部带) */}
        {!(def.kind === 'text' && isPath) && <StatusBadge status={status} />}
      </div>
    </div>
  )
}

// ---- 路径输入组件 ----

interface PathFieldProps {
  value: string
  placeholder?: string
  onChange: (v: string) => void
  onCommit?: () => void
  /** 点击「在资源管理器中打开」时调用(undefined 时按钮隐藏) */
  onOpenInExplorer?: () => void
  /** 点击「选择目录」拿到路径后回调(可以是文件选择器返回的 basename 路径片段) */
  onPick: (picked: string) => void
  /** 紧凑模式(用于 ConfigRow 内):按钮图标更小 */
  compact?: boolean
  /** 状态指示(紧凑模式用) */
  withStatus?: boolean
  status?: FieldStatus
  removable?: boolean
  onRemove?: () => void
}

function PathField({
  value,
  placeholder,
  onChange,
  onCommit,
  onOpenInExplorer,
  onPick,
  compact,
  withStatus,
  status = 'idle',
  removable,
  onRemove,
}: PathFieldProps) {
  const pushToast = useUIStore((s) => s.pushToast)
  const inputRef = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState(false)

  // 「选择目录」:用浏览器原生 showDirectoryPicker(Chrome/Edge 支持)。
  // 拿到的 FileSystemDirectoryHandle 不能直接给完整绝对路径(出于浏览器安全),
  // 只能取 handle.name(basename)+ 父目录名。降级时提示用户复制粘贴。
  async function handlePick() {
    if (picking) return
    const w = window as any
    if (typeof w.showDirectoryPicker !== 'function') {
      pushToast({
        kind: 'info',
        message: '当前浏览器不支持「选择目录」API,请直接复制粘贴路径到输入框',
        ttl: 4000,
      })
      inputRef.current?.focus()
      return
    }
    setPicking(true)
    try {
      const handle = await w.showDirectoryPicker({ mode: 'read' })
      // handle.name 是目录 basename;无法拿到完整绝对路径(浏览器安全限制)
      // 仍然把 basename 填入,并保留旧路径前缀,降低用户输入量
      const baseName = (handle as any).name as string
      // 尝试从旧 value 推断父目录;如果旧值也是 basename,就直接替换
      const parts = value.split(/[\\/]/).filter(Boolean)
      let newValue: string
      if (parts.length <= 1) {
        // 旧值就是单段(basename),直接替换
        newValue = baseName
      } else {
        // 旧值是完整路径,把最后一段替换成 baseName
        parts[parts.length - 1] = baseName
        newValue = parts.join('\\')
      }
      onPick(newValue)
      pushToast({
        kind: 'info',
        message: `已填入目录名「${baseName}」;浏览器为安全只暴露 basename,完整路径请手动补全`,
        ttl: 5000,
      })
    } catch (e: any) {
      // 用户取消选择:不报错
      if (e?.name !== 'AbortError') {
        pushToast({ kind: 'error', message: '选择目录失败:' + (e?.message ?? '未知错误') })
      }
    } finally {
      setPicking(false)
    }
  }

  // 提交:Enter / Blur
  const commit = () => onCommit?.()

  const btnSize = compact ? 'h-7 w-7' : 'h-8 w-8'
  const iconSize = compact ? 12 : 14

  return (
    <div className="flex items-center gap-2 w-full">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.currentTarget as HTMLInputElement).blur()
          } else if (e.key === 'Escape') {
            // 取消:不 commit,恢复原值(让 onBlur 仍触发但内容未变)
            ;(e.currentTarget as HTMLInputElement).blur()
          }
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-bg-subtle border border-border-faint rounded-md h-8 px-2.5 text-sm font-mono focus:outline-none focus:border-accent"
      />
      {/* 「选择目录」 */}
      <button
        type="button"
        onClick={handlePick}
        disabled={picking}
        title="选择本地目录(浏览器原生选择器;部分浏览器会填入 basename)"
        className={`inline-flex items-center justify-center ${btnSize} rounded-md border border-border-faint text-fg-muted hover:text-fg hover:border-border-strong transition-colors disabled:opacity-40`}
      >
        {picking ? (
          <span className="inline-block w-3 h-3 rounded-full border-2 border-fg-muted border-t-transparent animate-spin" />
        ) : (
          <FolderSearchIcon size={iconSize} />
        )}
      </button>
      {/* 「在资源管理器中打开」 */}
      {onOpenInExplorer && (
        <button
          type="button"
          onClick={onOpenInExplorer}
          title="在系统文件管理器中打开此目录"
          className={`inline-flex items-center justify-center ${btnSize} rounded-md border border-border-faint text-fg-muted hover:text-fg hover:border-border-strong transition-colors`}
        >
          <FolderOpenIcon size={iconSize} />
        </button>
      )}
      {/* 「移除」(多根列表用) */}
      {removable && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="删除此根目录"
          className={`inline-flex items-center justify-center ${btnSize} rounded-md border border-border-faint text-fg-subtle hover:text-danger hover:border-danger/40 transition-colors`}
        >
          <TrashIcon size={iconSize} />
        </button>
      )}
      {/* 状态指示 */}
      {withStatus && <StatusBadge status={status} />}
    </div>
  )
}

// 打开 cacheDir/staticDir 时需要带 allowConfig=1
async function openConfigPath(path: string, fieldKey: string): Promise<void> {
  const ui = useUIStore.getState()
  try {
    // 直接调 fetch,fsApi 没暴露 allowConfig 参数(避免污染通用 API)
    const res = await fetch(`/api/fs/open?path=${encodeURIComponent(path)}&allowConfig=1`, {
      method: 'GET',
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 403) {
        if (body.includes('allowOsOpen')) {
          ui.pushToast({ kind: 'warning', message: '请先在「安全」里开启「允许在系统文件管理器中打开」' })
        } else {
          ui.pushToast({ kind: 'error', message: '该路径不在可打开白名单(cacheDir/staticDir/mediaRoots)' })
        }
      } else {
        ui.pushToast({ kind: 'error', message: `打开失败 (${res.status}): ${body}` })
      }
      return
    }
    // 200:成功,不做额外提示
    void fieldKey // 暂时无额外用途
  } catch (e: any) {
    ui.pushToast({ kind: 'error', message: '网络错误:' + (e?.message ?? '未知') })
  }
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
  if (status === 'idle') return <span className="w-4 shrink-0" />
  if (status === 'saving') {
    return (
      <span
        className="inline-block w-3 h-3 rounded-full border-2 border-fg-muted border-t-transparent animate-spin shrink-0"
        aria-label="保存中"
      />
    )
  }
  if (status === 'saved') {
    return <CheckIcon size={14} className="text-accent shrink-0" aria-label="已保存" />
  }
  return <AlertIcon size={14} className="text-danger shrink-0" aria-label="保存失败" />
}
