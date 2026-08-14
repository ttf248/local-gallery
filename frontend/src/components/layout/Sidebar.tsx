import { NavLink } from 'react-router-dom'
import { HomeIcon, ClockIcon, StarIcon, SettingsIcon, ChevronLeftIcon, ChevronRightIcon } from '../common/Icon'

interface Props {
  collapsed: boolean
  onToggle: () => void
}

const items = [
  { to: '/', label: '主页', Icon: HomeIcon, end: true },
  { to: '/recents', label: '最近', Icon: ClockIcon, end: false },
  { to: '/favorites', label: '收藏', Icon: StarIcon, end: false },
  { to: '/settings', label: '设置', Icon: SettingsIcon, end: false },
]

// 侧边栏：克制的纯色块 + SVG 图标 + 折叠动画。
export default function Sidebar({ collapsed, onToggle }: Props) {
  return (
    <aside
      className={`flex flex-col bg-bg-elevated border-r border-border transition-[width] duration-200 ease-out ${
        collapsed ? 'w-[60px]' : 'w-[220px]'
      }`}
    >
      <div className={`h-14 flex items-center px-3 border-b border-border ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Logo />
            <span className="font-display font-semibold tracking-tight">Manga</span>
          </div>
        )}
        {collapsed && <Logo />}
        <button
          onClick={onToggle}
          className="text-fg-muted hover:text-fg p-1.5 rounded hover:bg-bg-subtle transition-colors"
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          title={collapsed ? '展开' : '折叠'}
        >
          {collapsed ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
        </button>
      </div>

      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm ${
                isActive
                  ? 'bg-accent-soft text-fg font-medium'
                  : 'text-fg-muted hover:bg-bg-subtle hover:text-fg'
              } ${collapsed ? 'justify-center px-2' : ''}`
            }
          >
            <it.Icon size={16} className="shrink-0" />
            {!collapsed && <span className="truncate">{it.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 text-[11px] text-fg-subtle border-t border-border">
        {!collapsed && <span>v0.2.0</span>}
      </div>
    </aside>
  )
}

function Logo() {
  return (
    <div className="w-7 h-7 rounded-md bg-accent text-accent-fg flex items-center justify-center font-display font-bold text-sm shadow-sm">
      M
    </div>
  )
}
