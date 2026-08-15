import { NavLink, useLocation } from 'react-router-dom'
import {
  HomeIcon,
  ClockIcon,
  StarIcon,
  SettingsIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ShuffleIcon,
} from '../common/Icon'
import { useNavigate } from 'react-router-dom'
import { useLibraryStore } from '../../store/libraryStore'
import { useUIStore } from '../../store/uiStore'

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

// 侧边栏：
// - 极简的图标列；展开时多 8px 内边距 + 文字
// - 透明背景，仅在 hover/active 时出现 subtle 背景
// - 顶部的 "Viewer" 文字标只在展开时显示，折叠时仅保留品牌方块
export default function Sidebar({ collapsed, onToggle }: Props) {
  const result = useLibraryStore((s) => s.result)
  const navigate = useNavigate()
  const location = useLocation()
  const pushToast = useUIStore((s) => s.pushToast)

  const onShuffle = () => {
    if (!result || result.albums.length === 0) {
      pushToast({ kind: 'info', message: '尚未加载图像库' })
      return
    }
    const idx = Math.floor(Math.random() * result.albums.length)
    const a = result.albums[idx]
    navigate(`/albums/${encodeURIComponent(a.path)}`)
  }

  return (
    <aside
      className={`flex flex-col glass border-r border-border-faint transition-[width] duration-200 ease-out ${
        collapsed ? 'w-[60px]' : 'w-[208px]'
      }`}
    >
      <div
        className={`h-14 relative flex items-center px-3 ${
          collapsed ? 'justify-center' : 'justify-between'
        }`}
      >
        {!collapsed ? (
          <div className="flex items-center gap-2.5 min-w-0">
            <Logo />
            <div className="leading-none min-w-0">
              <div className="font-display font-semibold tracking-tight text-sm truncate">
                Viewer
              </div>
              <div className="text-[10px] text-fg-subtle mt-0.5 truncate">本地图像 · viewer</div>
            </div>
          </div>
        ) : (
          <Logo />
        )}
        <button
          onClick={onToggle}
          className={`text-fg-subtle hover:text-fg p-1 rounded hover:bg-bg-subtle transition-colors ${
            collapsed ? 'absolute -right-3 top-4 bg-bg-elevated border border-border-faint shadow-sm' : ''
          }`}
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          title={collapsed ? '展开' : '折叠'}
        >
          {collapsed ? <ChevronRightIcon size={12} /> : <ChevronLeftIcon size={12} />}
        </button>
      </div>

      <nav className="flex-1 py-3 px-2 space-y-0.5">
        <div className="px-1.5 mb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-fg-subtle">
          {!collapsed ? '导航' : ''}
        </div>
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

        {/* 随机一本 — 单独一行，折叠时仍可见图标 */}
        <button
          onClick={onShuffle}
          title="随机一本 (R)"
          className={`w-full flex items-center gap-2.5 h-9 rounded-md text-[13px] transition-colors ${
            collapsed ? 'justify-center px-0' : 'px-2.5'
          } text-fg-muted hover:bg-accent-soft hover:text-accent`}
        >
          <ShuffleIcon size={15} className="shrink-0" />
          {!collapsed && <span className="truncate">随机一本</span>}
        </button>
      </nav>

      {!collapsed && (
        <div className="px-4 py-3.5">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                location.pathname.startsWith('/viewer') ? 'bg-accent' : 'bg-success'
              }`}
            />
            <span>{location.pathname.startsWith('/viewer') ? '阅读中' : '已就绪'}</span>
          </div>
        </div>
      )}
    </aside>
  )
}

// 品牌方块：纯几何 + 字形，使用 accent 颜色
function Logo() {
  return (
    <div className="relative w-7 h-7 shrink-0">
      <div className="absolute inset-0 rounded-md bg-accent" />
      <div className="absolute inset-0 flex items-center justify-center text-accent-contrast font-display font-semibold text-[13px] tracking-tighter">
        M
      </div>
    </div>
  )
}
