import { useEffect } from 'react'
import { SHORTCUTS } from '../../utils/shortcuts'
import { CloseIcon } from './Icon'

interface Props {
  open: boolean
  onClose: () => void
}

const groups: { title: string; ids: string[] }[] = [
  { title: '全局', ids: ['open', 'scan', 'refresh', 'home', 'recents', 'favorites', 'settings', 'help'] },
  { title: '查看器', ids: ['next', 'prev', 'first', 'last', 'zoomIn', 'zoomOut', 'zoomReset', 'rotate', 'fullscreen', 'slideshow', 'info'] },
]

// 帮助浮层：左侧导航分组 + 右侧快捷键列表，背景遮罩。
export default function HelpOverlay({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const byId = new Map(SHORTCUTS.map((s) => [s.id, s]))
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm fade-up"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-bg-elevated text-fg rounded-lg shadow-lg border border-border w-[720px] max-w-[94vw] max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <h2 className="font-display font-semibold">快捷键</h2>
            <p className="text-xs text-fg-muted mt-0.5">按下 Esc 或点击空白处关闭</p>
          </div>
          <button
            onClick={onClose}
            className="text-fg-muted hover:text-fg p-1 rounded hover:bg-bg-subtle"
            aria-label="关闭"
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-x-6 p-5">
          {groups.map((g) => (
            <div key={g.title} className="mb-4">
              <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider mb-2">
                {g.title}
              </h3>
              <ul className="space-y-1.5">
                {g.ids.map((id) => {
                  const s = byId.get(id)
                  if (!s) return null
                  return (
                    <li key={s.id} className="flex items-center justify-between text-sm">
                      <span className="text-fg-muted">{s.description}</span>
                      <kbd className="text-[11px] font-mono px-2 py-0.5 rounded border border-border bg-bg-subtle text-fg-muted">
                        {s.label}
                      </kbd>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
