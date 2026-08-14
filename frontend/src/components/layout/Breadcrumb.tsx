import { Link } from 'react-router-dom'
import { useUIStore } from '../../store/uiStore'

export default function Breadcrumb() {
  const crumbs = useUIStore((s) => s.breadcrumbs)
  return (
    <div className="h-8 flex items-center px-3 text-sm text-fg-muted border-b border-border bg-bg-elevated">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && <span className="mx-2 text-fg-subtle">/</span>}
          {c.to ? (
            <Link to={c.to} className="hover:text-fg">
              {c.label}
            </Link>
          ) : (
            <span>{c.label}</span>
          )}
        </span>
      ))}
    </div>
  )
}
