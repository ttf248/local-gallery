import { SHORTCUTS } from '../../utils/shortcuts'

interface Props {
  open: boolean
  onClose: () => void
}

// 帮助浮层：中央模态层 + 背景遮罩；按 Esc / 背景 / ✕ 关闭。
export default function HelpOverlay({ open, onClose }: Props) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-bg-elevated text-fg rounded-lg shadow-xl border border-border w-[640px] max-w-[92vw] max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-semibold">快捷键</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg" title="关闭 (Esc)">
            ✕
          </button>
        </header>

        <table className="w-full text-sm">
          <thead className="bg-bg-subtle text-fg-muted">
            <tr>
              <th className="text-left px-4 py-2 w-32">按键</th>
              <th className="text-left px-4 py-2">功能</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="px-4 py-2 font-mono text-xs">{s.label}</td>
                <td className="px-4 py-2">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="px-4 py-3 border-t border-border text-xs text-fg-muted">
          提示：按下 Esc 可关闭此窗口
        </footer>
      </div>
    </div>
  )
}