import { useEffect, useState } from 'react'
import { SHORTCUTS, type Shortcut } from '../../utils/shortcuts'
import { CloseIcon, SearchIcon, KeyboardIcon } from './Icon'

interface Props {
  open: boolean
  onClose: () => void
}

// 渲染顺序：先全局，再画廊。Title 单一来源。
const GROUP_ORDER: Array<{ key: NonNullable<Shortcut['group']>; title: string }> = [
  { key: 'global', title: '全局' },
  { key: 'gallery', title: '画廊' },
]

// 帮助浮层：可搜索的快捷键列表 + 分类。
// 视觉上：更大留白，单列紧凑列表；搜索框即时过滤。
//
// 数据源：直接消费 SHORTCUTS（按 group 字段分组）。新增/删除快捷键时，
// 只需修改 shortcuts.ts，HelpOverlay 自动同步。
export default function HelpOverlay({ open, onClose }: Props) {
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) setQ('')
  }, [open])

  const lc = q.trim().toLowerCase()

  if (!open) return null

  const matches = (s: Shortcut) => {
    if (!lc) return true
    return (
      s.id.toLowerCase().includes(lc) ||
      s.description.toLowerCase().includes(lc) ||
      s.label.toLowerCase().includes(lc)
    )
  }

  // 按 group 字段分组，渲染顺序由 GROUP_ORDER 决定
  const filteredGroups = GROUP_ORDER.map((g) => ({
    title: g.title,
    items: SHORTCUTS.filter((s) => s.group === g.key && matches(s)),
  })).filter((g) => g.items.length > 0)

  const total = filteredGroups.reduce((s, g) => s + g.items.length, 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-bg-elevated text-fg rounded-xl shadow-lg border border-border w-[680px] max-w-[94vw] max-h-[80vh] overflow-hidden flex flex-col scale-fade"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-6 h-14 border-b border-border-faint">

          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-accent-soft flex items-center justify-center text-accent">
              <KeyboardIcon size={14} />
            </div>
            <div>
              <h2 className="font-display text-sm font-medium">快捷键</h2>
              <p className="text-[11px] text-fg-subtle mt-0.5">
                按 <kbd className="kbd">?</kbd> 随时唤起
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-fg-muted hover:text-fg p-1.5 rounded hover:bg-bg-subtle transition-colors"
            aria-label="关闭"
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <div className="px-6 py-3 border-b border-border-faint">
          <div className="input-focus-ring flex items-center gap-2 bg-bg-subtle rounded-md px-3 h-9 focus-within:bg-bg-elevated focus-within:border focus-within:border-border-strong">
            <SearchIcon size={13} className="text-fg-subtle shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索快捷键…"
              className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-fg-subtle"
              autoFocus
            />
            {q && (
              <button
                onClick={() => setQ('')}
                className="text-fg-subtle hover:text-fg text-xs"
              >
                清除
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6 scroll-thin">
          {total === 0 && (
            <div className="col-span-2 text-center text-fg-muted text-sm py-12">
              没有匹配「{q}」的快捷键
            </div>
          )}
          {filteredGroups.map((g) => (
            <div key={g.title}>
              <h3 className="text-[10px] font-medium text-fg-subtle uppercase tracking-[0.18em] mb-3">
                {g.title}
              </h3>
              <ul className="space-y-1">
                {g.items.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between text-[13px] py-1.5"
                  >
                    <span className="text-fg-muted">{s.description}</span>
                    <kbd className="kbd shrink-0 ml-3">
                      {s.label}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
