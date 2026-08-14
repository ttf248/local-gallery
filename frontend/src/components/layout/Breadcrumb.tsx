import { Link } from 'react-router-dom'
import { useUIStore } from '../../store/uiStore'

export default function Breadcrumb() {
  const crumbs = useUIStore((s) => s.breadcrumbs)
  if (!crumbs.length) return null
  return (
    <nav className="px-4 lg:px-10 h-8 flex items-center text-xs text-fg-muted bg-bg-elevated/40">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && <span className="mx-2 text-fg-subtle">/</span>}
          {c.to ? (
            <Link to={c.to} className="hover:text-fg transition-colors">
              {c.label}
            </Link>
          ) : (
            <span className="text-fg">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
