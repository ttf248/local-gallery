import { useUIStore, type ThemePref } from '../../store/uiStore'
import { SunIcon, MoonIcon, MonitorIcon } from './Icon'

// 三态主题切换：浅色 / 深色 / 跟随系统。
export default function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)

  if (compact) {
    const next: ThemePref =
      theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    const cur = theme
    const Icon = cur === 'light' ? SunIcon : cur === 'dark' ? MoonIcon : MonitorIcon
    return (
      <button
        onClick={() => setTheme(next)}
        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
        title={`主题: ${cur === 'light' ? '浅色' : cur === 'dark' ? '深色' : '系统'}`}
      >
        <Icon size={15} />
      </button>
    )
  }

  const opts: { value: ThemePref; label: string; Icon: typeof SunIcon }[] = [
    { value: 'light', label: '浅色', Icon: SunIcon },
    { value: 'dark', label: '深色', Icon: MoonIcon },
    { value: 'system', label: '系统', Icon: MonitorIcon },
  ]

  return (
    <div className="inline-flex border border-border rounded-md overflow-hidden bg-bg-elevated">
      {opts.map((o) => (
        <button
          key={o.value}
          onClick={() => setTheme(o.value)}
          className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors ${
            theme === o.value
              ? 'bg-accent text-accent-fg'
              : 'text-fg-muted hover:text-fg hover:bg-bg-subtle'
          }`}
        >
          <o.Icon size={12} />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}
