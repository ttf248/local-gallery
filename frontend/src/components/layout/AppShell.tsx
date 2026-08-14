import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useUIStore } from '../../store/uiStore'
import { useKeyboard } from '../../hooks/useKeyboard'
import { useTheme } from '../../hooks/useTheme'
import Sidebar from './Sidebar'
import Toolbar from './Toolbar'
import StatusBar from './StatusBar'
import Breadcrumb from './Breadcrumb'

// 应用外壳：侧边栏 + 工具栏 + 主内容 + 状态栏。
// 所有页面（除 Viewer 全屏外）都通过这个布局渲染。
export default function AppShell() {
  useTheme()
  const location = useLocation()
  const setBreadcrumbs = useUIStore((s) => s.setBreadcrumbs)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  // 简易路由 → 面包屑映射
  useEffect(() => {
    const p = location.pathname
    if (p === '/') setBreadcrumbs([{ label: '主页', to: '/' }])
    else if (p.startsWith('/recents')) setBreadcrumbs([{ label: '主页', to: '/' }, { label: '最近' }])
    else if (p.startsWith('/favorites')) setBreadcrumbs([{ label: '主页', to: '/' }, { label: '收藏' }])
    else if (p.startsWith('/settings')) setBreadcrumbs([{ label: '主页', to: '/' }, { label: '设置' }])
    else if (p.startsWith('/albums')) setBreadcrumbs([{ label: '主页', to: '/' }, { label: '相册' }])
    else setBreadcrumbs([{ label: '主页', to: '/' }])
  }, [location.pathname, setBreadcrumbs])

  // 全局快捷键
  useKeyboard({
    // 占位：T10/T12 接入具体动作
    f5: () => window.location.reload(),
  })

  return (
    <div className="flex h-full">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <div className="flex-1 flex flex-col min-w-0">
        <Toolbar />
        <Breadcrumb />
        <main className="flex-1 overflow-auto bg-bg">
          <Outlet />
        </main>
        <StatusBar />
      </div>
    </div>
  )
}
