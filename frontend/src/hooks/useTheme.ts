import { useEffect } from 'react'
import { useUIStore, type ThemePref } from '../store/uiStore'

// 把 store 中的主题偏好同步到 :root[data-theme]。
// 'system' 时跟随 prefers-color-scheme。
export function useTheme() {
  const theme = useUIStore((s) => s.theme)

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

  return theme
}