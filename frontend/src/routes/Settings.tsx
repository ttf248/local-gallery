import ThemeSwitcher from '../components/common/ThemeSwitcher'
import { useUIStore } from '../store/uiStore'

export default function Settings() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">设置</h1>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">外观</h2>
        <div className="flex items-center justify-between py-2">
          <span>主题</span>
          <ThemeSwitcher />
        </div>
        <div className="flex items-center justify-between py-2">
          <span>侧边栏折叠</span>
          <button
            onClick={toggleSidebar}
            className="px-3 py-1 rounded border border-border hover:bg-bg-subtle"
          >
            {sidebarCollapsed ? '展开' : '折叠'}
          </button>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">关于</h2>
        <p className="text-fg-muted text-sm">
          Comic Reader Web 版 · T13 主题切换已就绪。
        </p>
      </section>
    </div>
  )
}