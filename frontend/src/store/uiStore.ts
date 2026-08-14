import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// UI 状态：侧边栏折叠、面包屑等。
// 仅持久化侧边栏折叠态（外观偏好 → localStorage）。
interface UIState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void

  breadcrumbs: { label: string; to?: string }[]
  setBreadcrumbs: (bc: { label: string; to?: string }[]) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      breadcrumbs: [],
      setBreadcrumbs: (bc) => set({ breadcrumbs: bc }),
    }),
    {
      name: 'comic-reader-ui',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
)
