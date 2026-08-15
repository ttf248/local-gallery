import { useUIStore, type ThemePref, type AccentKey } from '../../store/uiStore'
import { SunIcon, MoonIcon, MonitorIcon, CheckIcon } from './Icon'
import { useState, useEffect, useRef } from 'react'

const ACCENT_PREVIEWS: { id: AccentKey; color: string }[] = [
  { id: 'graphite', color: '#18181b' },
  { id: 'indigo', color: '#4f46e5' },
  { id: 'rose', color: '#e11d48' },
  { id: 'forest', color: '#059669' },
  { id: 'ochre', color: '#d97706' },
  { id: 'plum', color: '#7c3aed' },
]

// 主题切换：
//  - compact：单按钮，按顺序循环切换 light/dark/system（兼容旧版工具栏使用）
//  - default：下拉菜单，可分别选主题与强调色
export default function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const accent = useUIStore((s) => s.accent)
  const setAccent = useUIStore((s) => s.setAccent)

  if (compact) {
    return <CompactSwitch theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />
  }

  return (
    <div className="inline-flex border border-border rounded-md overflow-hidden bg-bg-elevated">
      {[
        { value: 'light', label: '浅色', Icon: SunIcon },
        { value: 'dark', label: '深色', Icon: MoonIcon },
        { value: 'system', label: '系统', Icon: MonitorIcon },
      ].map((o) => (
        <button
          key={o.value}
          onClick={() => setTheme(o.value as ThemePref)}
          className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors ${
            theme === o.value
              ? 'bg-accent text-accent-contrast'
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

// compact：单按钮 + 下拉面板（同时切换主题与强调色）
function CompactSwitch({
  theme,
  setTheme,
  accent,
  setAccent,
}: {
  theme: ThemePref
  setTheme: (t: ThemePref) => void
  accent: AccentKey
  setAccent: (a: AccentKey) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    setTimeout(() => {
      window.addEventListener('mousedown', onClick)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cur =
    theme === 'light' ? SunIcon : theme === 'dark' ? MoonIcon : MonitorIcon
  const Icon = cur
  const accentColor = ACCENT_PREVIEWS.find((a) => a.id === accent)?.color ?? '#18181b'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors relative"
        title={`主题: ${theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '系统'} · 强调色`}
      >
        <Icon size={14} />
        <span
          className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full ring-2 ring-bg-elevated"
          style={{ background: accentColor }}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[240px] bg-bg-elevated border border-border rounded-md shadow-md z-40 p-2 fade-up">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle px-2 py-1.5">
            主题
          </div>
          <div className="grid grid-cols-3 gap-1 px-1">
            {[
              { v: 'light', l: '浅色' },
              { v: 'dark', l: '深色' },
              { v: 'system', l: '系统' },
            ].map((o) => {
              const active = theme === o.v
              return (
                <button
                  key={o.v}
                  onClick={() => setTheme(o.v as ThemePref)}
                  className={`relative h-8 rounded text-xs transition-colors ${
                    active
                      ? 'bg-accent text-accent-contrast'
                      : 'text-fg-muted hover:bg-bg-subtle hover:text-fg'
                  }`}
                >
                  {o.l}
                  {active && <CheckIcon size={10} className="absolute top-0.5 right-0.5" />}
                </button>
              )
            })}
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle px-2 pt-3 pb-1.5">
            强调色
          </div>
          <div className="grid grid-cols-6 gap-1.5 px-1">
            {ACCENT_PREVIEWS.map((a) => {
              const active = accent === a.id
              return (
                <button
                  key={a.id}
                  onClick={() => setAccent(a.id)}
                  className="relative w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{ background: a.color }}
                  title={a.id}
                >
                  {active && (
                    <span className="absolute inset-0 ring-2 ring-fg ring-offset-2 ring-offset-bg-elevated rounded-full" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

