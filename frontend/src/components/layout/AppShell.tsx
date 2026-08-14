import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useUIStore } from '../../store/uiStore'
import { useKeyboard } from '../../hooks/useKeyboard'
import { useTheme } from '../../hooks/useTheme'
import Sidebar from './Sidebar'
import Toolbar from './Toolbar'
import ToastViewport from '../common/Toast'
import HelpOverlay from '../common/HelpOverlay'

// 应用外壳：侧边栏 + 工具栏 + 主内容。
// 全局帮助浮层通过 comic:open-help 事件触发（所有页面 ? 都能唤起）。
export default function AppShell() {
  useTheme()
  const location = useLocation()
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setBreadcrumbs = useUIStore((s) => s.setBreadcrumbs)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    const titles: Record<string, string> = {
      '/': '漫画库',
      '/recents': '最近',
      '/favorites': '收藏',
      '/settings': '设置',
    }
    const base = titles[location.pathname] ?? '相册'
    document.title = `${base} · Manga`

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

  useEffect(() => {
    const fn = () => setHelpOpen(true)
    window.addEventListener('comic:open-help', fn as EventListener)
    return () => window.removeEventListener('comic:open-help', fn as EventListener)
  }, [])

  useKeyboard({
    'ctrl+b': () => toggleSidebar(),
    'ctrl+h': () => (window.location.href = '/'),
    'ctrl+d': () => (window.location.href = '/favorites'),
    'ctrl+,': () => (window.location.href = '/settings'),
    'shift+/': () => setHelpOpen((v) => !v),
    '/': () => {
      const el = document.querySelector<HTMLInputElement>('input[placeholder^="搜索"]')
      el?.focus()
    },
  })

  return (
    <div className="flex h-full bg-bg">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <div className="flex-1 flex flex-col min-w-0">
        <Toolbar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <ToastViewport />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
