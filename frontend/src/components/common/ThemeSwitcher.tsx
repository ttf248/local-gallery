import { useUIStore, type ThemePref } from '../../store/uiStore'

const OPTIONS: { value: ThemePref; label: string; icon: string }[] = [
  { value: 'light', label: '浅色', icon: '☀' },
  { value: 'dark', label: '深色', icon: '☾' },
  { value: 'system', label: '系统', icon: '⌬' },
]

// 三态主题切换（浅色 / 深色 / 跟随系统）。
// 紧凑模式下渲染为单个按钮（点击循环切换）；展开模式为按钮组。
export default function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)

  if (compact) {
    const next: ThemePref =
      theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    const cur = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2]
    return (
      <button
        onClick={() => setTheme(next)}
        className="px-2 py-1 rounded hover:bg-bg-subtle"
        title={`主题: ${cur.label}（点击切换）`}
      >
        {cur.icon}
      </button>
    )
  }

  return (
    <div className="inline-flex border border-border rounded overflow-hidden">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => setTheme(o.value)}
          className={`px-2 py-1 text-sm ${
            theme === o.value ? 'bg-bg-subtle text-fg' : 'text-fg-muted hover:text-fg'
          }`}
          title={o.label}
        >
          <span className="mr-1">{o.icon}</span>
          {o.label}
        </button>
      ))}
    </div>
  )
}