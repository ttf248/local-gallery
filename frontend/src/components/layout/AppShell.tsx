import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useUIStore } from '../../store/uiStore'
import { useKeyboard } from '../../hooks/useKeyboard'
import { useTheme } from '../../hooks/useTheme'
import Sidebar from './Sidebar'
import Toolbar from './Toolbar'
import StatusBar from './StatusBar'

// 应用外壳：侧边栏 + 工具栏 + 主内容 + 状态栏。
// 所有页面（除 Viewer 全屏外）都通过这个布局渲染。
export default function AppShell() {
  useTheme()
  const location = useLocation()
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setBreadcrumbs = useUIStore((s) => s.setBreadcrumbs)

  // 简易路由 → 顶部标题（用于屏幕阅读器与标签页）
  useEffect(() => {
    const titles: Record<string, string> = {
      '/': '漫画库',
      '/recents': '最近',
      '/favorites': '收藏',
      '/settings': '设置',
    }
    const base = titles[location.pathname] ?? '相册'
    document.title = `${base} · 漫画阅读器`

    // 面包屑
    if (location.pathname === '/') setBreadcrumbs([])
    else if (location.pathname.startsWith('/recents'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '最近' }])
    else if (location.pathname.startsWith('/favorites'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '收藏' }])
    else if (location.pathname.startsWith('/settings'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '设置' }])
    else if (location.pathname.startsWith('/albums'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '相册' }])
  }, [location.pathname, setBreadcrumbs])

  // 全局快捷键
  useKeyboard({
    'ctrl+b': () => toggleSidebar(),
    'ctrl+h': () => (window.location.href = '/'),
    'ctrl+d': () => (window.location.href = '/favorites'),
    'ctrl+,': () => (window.location.href = '/settings'),
    '?': () => {
      // 帮助浮层由具体页面渲染，这里仅作占位
      window.dispatchEvent(new CustomEvent('comic:open-help'))
    },
    '/': () => {
      const el = document.querySelector<HTMLInputElement>('input[placeholder^="搜索"]')
      el?.focus()
    },
  })

  return (
    <div className="flex h-full">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <div className="flex-1 flex flex-col min-w-0">
        <Toolbar />
        <main className="flex-1 overflow-auto bg-bg">
          <Outlet />
        </main>
        <StatusBar />
      </div>
    </div>
  )
}
