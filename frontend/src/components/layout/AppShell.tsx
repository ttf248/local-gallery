import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useUIStore } from '../../store/uiStore'
import { useKeyboard } from '../../hooks/useKeyboard'
import { useTheme } from '../../hooks/useTheme'
import { useLibraryStore } from '../../store/libraryStore'
import { albumRoute } from '../../utils/path'
import Sidebar from './Sidebar'
import Toolbar from './Toolbar'
import ToastViewport from '../common/Toast'
import HelpOverlay from '../common/HelpOverlay'

// 应用外壳：侧边栏 + 工具栏 + 主内容。
// 全局帮助浮层通过 comic:open-help 事件触发（所有页面 ? 都能唤起）。
export default function AppShell() {
  useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setBreadcrumbs = useUIStore((s) => s.setBreadcrumbs)
  const pushToast = useUIStore((s) => s.pushToast)
  const result = useLibraryStore((s) => s.result)
  const [helpOpen, setHelpOpen] = useState(false)
  const onViewer = location.pathname.startsWith('/viewer')

  useEffect(() => {
    const titles: Record<string, string> = {
      '/': '图像库',
      '/recents': '最近',
      '/favorites': '收藏',
      '/settings': '设置',
    }
    const path = location.pathname
    let base = titles[path]
    if (base === undefined) {
      if (path.startsWith('/authors/')) {
        const raw = decodeURIComponent(path.slice('/authors/'.length))
        base = raw || '作者'
      } else if (path.startsWith('/albums')) {
        base = '文件夹'
      } else {
        base = '文件夹'
      }
    }
    document.title = `${base} · Viewer`

    if (path === '/') setBreadcrumbs([])
    else if (path.startsWith('/recents'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '最近' }])
    else if (path.startsWith('/favorites'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '收藏' }])
    else if (path.startsWith('/settings'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '设置' }])
    else if (path.startsWith('/albums'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '文件夹' }])
    else if (path.startsWith('/authors/')) {
      const raw = decodeURIComponent(path.slice('/authors/'.length))
      setBreadcrumbs([
        { label: '主页', to: '/' },
        { label: '作者', to: '/' },
        { label: raw },
      ])
    }
  }, [location.pathname, setBreadcrumbs])

  useEffect(() => {
    const fn = () => setHelpOpen(true)
    window.addEventListener('comic:open-help', fn as EventListener)
    return () => window.removeEventListener('comic:open-help', fn as EventListener)
  }, [])

  const goShuffle = () => {
    if (!result || result.albums.length === 0) {
      pushToast({ kind: 'info', message: '尚未加载图像库' })
      return
    }
    const idx = Math.floor(Math.random() * result.albums.length)
    const a = result.albums[idx]
    navigate(albumRoute(a.path))
  }

  useKeyboard({
    'ctrl+b': () => toggleSidebar(),
    'ctrl+h': () => navigate('/'),
    'ctrl+d': () => navigate('/favorites'),
    'ctrl+,': () => navigate('/settings'),
    'ctrl+r': () => navigate('/recents'),
    'shift+/': () => setHelpOpen((v) => !v),
    '/': () => {
      const el = document.querySelector<HTMLInputElement>('input[placeholder^="搜索"]')
      el?.focus()
    },
    // 随机一本：仅在非 viewer 页面生效（viewer 的 r 用于旋转）
    r: () => {
      if (onViewer) return
      goShuffle()
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
