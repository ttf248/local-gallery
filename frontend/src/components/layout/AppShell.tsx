import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useUIStore } from '../../store/uiStore'
import { useKeyboard } from '../../hooks/useKeyboard'
import { useTheme } from '../../hooks/useTheme'
import { useLibraryStore } from '../../store/libraryStore'
import { albumRoute } from '../../utils/path'
import { fsApi } from '../../api/fs'
import { scanApi } from '../../api/scan'
import { useScanSSE } from '../../hooks/useScanSSE'
import Sidebar from './Sidebar'
import Toolbar from './Toolbar'
import StatusBar from './StatusBar'
import ScanProgress from '../album/ScanProgress'
import ToastViewport from '../common/Toast'
import HelpOverlay from '../common/HelpOverlay'
import ErrorBoundary from '../common/ErrorBoundary'

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
  const onGallery = location.pathname.startsWith('/gallery')
  // 扫描进度 + 取消（提升到 AppShell 后所有路由都能看到顶部进度条）
  const scanSse = useScanSSE()

  // 启动时同步服务端能力（fsCapabilities.allowOsOpen），
  // 否则 Album 详情 / 右键菜单的"在资源管理器中打开"按钮永远 disabled。
  useEffect(() => {
    void fsApi.syncCapabilities()
  }, [])

  useEffect(() => {
    const titles: Record<string, string> = {
      '/': '图像库',
      '/recents': '最近',
      '/favorites': '收藏',
      '/unread': '未读',
      '/settings': '设置',
    }
    const path = location.pathname
    let base = titles[path]
    if (base === undefined) {
      if (path.startsWith('/tags/')) {
        const raw = decodeURIComponent(path.slice('/tags/'.length))
        base = raw || '标签'
      } else if (path.startsWith('/albums')) {
        base = '文件夹'
      } else {
        base = '文件夹'
      }
    }
    document.title = `${base} · Local Gallery`

    if (path === '/') setBreadcrumbs([])
    else if (path.startsWith('/recents'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '最近' }])
    else if (path.startsWith('/favorites'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '收藏' }])
    else if (path.startsWith('/unread'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '未读' }])
    else if (path.startsWith('/settings'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '设置' }])
    else if (path.startsWith('/albums'))
      setBreadcrumbs([{ label: '主页', to: '/' }, { label: '文件夹' }])
    else if (path.startsWith('/tags/')) {
      const raw = decodeURIComponent(path.slice('/tags/'.length))
      setBreadcrumbs([
        { label: '主页', to: '/' },
        { label: '标签', to: '/' },
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
    '?': () => setHelpOpen((v) => !v),
    '/': () => {
      const el = document.querySelector<HTMLInputElement>('input[placeholder^="搜索"]')
      el?.focus()
    },
    // 随机一本：仅在非 gallery 页面生效（gallery 的 r 用于旋转）
    r: () => {
      if (onGallery) return
      goShuffle()
    },
    // U → 未读页
    u: () => {
      if (onGallery) return
      navigate('/unread')
    },
  })

  return (
    <div className="flex h-full bg-bg">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <div className="flex-1 flex flex-col min-w-0">
        <Toolbar />
        <main className="flex-1 overflow-auto">
          {/* 路由层错误兜底:任意子组件 render 抛错都不会让整个 SPA 白屏。 */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
        <StatusBar />
      </div>
      {/*
        扫描进度卡：左下角浮动卡（fixed，相对 viewport）。
        必须在 <main> 外面，否则会被 main 的 overflow-auto 影响 sticky/fixed 行为。
        scanSse.startWith 由 Toolbar 在用户触发「重新扫描」/ Ctrl+S 时写 store.scanId。
      */}
      <ScanProgress
        progress={scanSse.progress}
        onCancel={() =>
          scanSse.scanId && scanApi.cancel(scanSse.scanId).catch(() => {})
        }
      />
      <ToastViewport />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
