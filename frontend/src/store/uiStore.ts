import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemePref = 'light' | 'dark' | 'system'

// UI 状态：侧边栏折叠、面包屑、主题。
// 仅持久化外观偏好（侧边栏折叠、主题）→ localStorage。
interface UIState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void

  theme: ThemePref
  setTheme: (t: ThemePref) => void

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

      theme: 'system',
      setTheme: (t) => set({ theme: t }),

      breadcrumbs: [],
      setBreadcrumbs: (bc) => set({ breadcrumbs: bc }),
    }),
    {
      name: 'comic-reader-ui',
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        theme: s.theme,
      }),
    },
  ),
)