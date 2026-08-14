import { NavLink } from 'react-router-dom'

interface Props {
  collapsed: boolean
  onToggle: () => void
}

const items = [
  { to: '/', label: '主页', icon: '🏠' },
  { to: '/recents', label: '最近', icon: '🕘' },
  { to: '/favorites', label: '收藏', icon: '⭐' },
  { to: '/settings', label: '设置', icon: '⚙' },
]

export default function Sidebar({ collapsed, onToggle }: Props) {
  return (
    <aside
      className={`flex flex-col bg-bg-elevated border-r border-border transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className="h-12 flex items-center justify-between px-3 border-b border-border">
        {!collapsed && <span className="font-semibold">漫画阅读器</span>}
        <button
          onClick={onToggle}
          className="text-fg-muted hover:text-fg p-1"
          aria-label="折叠侧边栏"
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>
      <nav className="flex-1 py-2">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 mx-2 rounded transition-colors ${
                isActive
                  ? 'bg-accent text-white'
                  : 'text-fg-muted hover:bg-bg-subtle hover:text-fg'
              }`
            }
            end={it.to === '/'}
          >
            <span className="text-lg">{it.icon}</span>
            {!collapsed && <span>{it.label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 text-xs text-fg-subtle border-t border-border">
        {!collapsed && <span>v0.1.0</span>}
      </div>
    </aside>
  )
}
