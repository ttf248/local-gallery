import { useEffect } from 'react'
import { useUIStore, type ThemePref, type AccentKey } from '../store/uiStore'

// 把 store 中的主题与强调色同步到 :root[data-theme] / :root[data-accent]。
// 'system' 时跟随 prefers-color-scheme。
export function useTheme() {
  const theme = useUIStore((s) => s.theme)
  const accent = useUIStore((s) => s.accent)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (t: ThemePref) => {
      const effective = t === 'system' ? (mql.matches ? 'dark' : 'light') : t
      document.documentElement.setAttribute('data-theme', effective)
    }
    apply(theme)

    if (theme === 'system') {
      const onChange = () => apply('system')
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent)
  }, [accent])

  return { theme, accent }
}

// 强调色调色板（用于设置页的色块）
export const ACCENT_SWATCHES: { id: AccentKey; name: string; light: string; dark: string }[] = [
  { id: 'graphite', name: '石墨', light: '#1f2937', dark: '#f3f1ee' },
  { id: 'indigo', name: '靛蓝', light: '#4f46e5', dark: '#a5b4fc' },
  { id: 'rose', name: '绯红', light: '#be3a4b', dark: '#f4a3ad' },
  { id: 'forest', name: '森林', light: '#2f6f4e', dark: '#88c9a3' },
  { id: 'ochre', name: '赭石', light: '#a86d20', dark: '#e3b577' },
  { id: 'plum', name: '紫梅', light: '#6f3da0', dark: '#c4a5e8' },
]
