import { NavLink } from 'react-router-dom'
import {
  HomeIcon,
  ClockIcon,
  StarIcon,
  SettingsIcon,
  LibraryIcon,
  HeartFilledIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '../common/Icon'

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

// 侧边栏：极简的图标列。展开时多 8px 内边距 + 文字。
// 视觉上更克制：透明背景、仅在 hover/active 时出现 subtle 背景。
export default function Sidebar({ collapsed, onToggle }: Props) {
  return (
    <aside
      className={`flex flex-col bg-bg-elevated/60 border-r border-border-faint transition-[width] duration-200 ease-out ${
        collapsed ? 'w-[56px]' : 'w-[200px]'
      }`}
    >
      <div
        className={`h-14 flex items-center px-3 border-b border-border-faint ${
          collapsed ? 'justify-center' : 'justify-between'
        }`}
      >
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <Logo />
            <div className="leading-none">
              <div className="font-display font-semibold tracking-tight text-sm">Manga</div>
              <div className="text-[10px] text-fg-subtle mt-0.5">本地漫画</div>
            </div>
          </div>
        ) : (
          <Logo />
        )}
        <button
          onClick={onToggle}
          className="text-fg-subtle hover:text-fg p-1 rounded hover:bg-bg-subtle transition-colors"
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          title={collapsed ? '展开' : '折叠'}
        >
          {collapsed ? <ChevronRightIcon size={13} /> : <ChevronLeftIcon size={13} />}
        </button>
      </div>

      <nav className="flex-1 py-2 px-2 space-y-0.5">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              `group flex items-center gap-2.5 h-9 rounded-md text-[13px] transition-colors ${
                collapsed ? 'justify-center px-0' : 'px-2.5'
              } ${
                isActive
                  ? 'bg-accent-soft text-fg font-medium'
                  : 'text-fg-muted hover:bg-bg-subtle hover:text-fg'
              }`
            }
          >
            <it.Icon size={15} className="shrink-0" />
            {!collapsed && <span className="truncate">{it.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* 底部统计 / 状态 */}
      {!collapsed && (
        <div className="px-3 py-3 border-t border-border-faint">
          <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
            <LibraryIcon size={11} />
            <span>已就绪</span>
          </div>
        </div>
      )}
    </aside>
  )
}

function Logo() {
  return (
    <div className="w-7 h-7 rounded-md bg-accent text-accent-fg flex items-center justify-center font-display font-semibold text-[13px]">
      M
    </div>
  )
}

// 用于导出：保留旧引用
export { HeartFilledIcon }
