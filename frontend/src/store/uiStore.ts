import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePref = "light" | "dark" | "system";
export type ViewMode = "grid" | "list";

// UI 状态：侧边栏、主题、视图模式、toast 通知。
//
// 持久化覆盖外观与浏览偏好（侧边栏折叠、主题、视图模式、人脸框）→ localStorage。
// toast、面包屑等临时状态不进 localStorage。
interface Toast {
  id: string;
  kind: "info" | "success" | "warning" | "error";
  message: string;
  ttl: number;
  /**
   * 可选的撤销入口。
   *
   * 写操作一旦让东西从眼前消失，用户就没法反悔 —— 例如把一组标记成
   * 「已处理」后它离开待处理列表。给一条带「撤销」的提示，用户不必
   * 去别的筛选里把它翻出来。
   */
  action?: { label: string; onClick: () => void };
}

export interface UIState {
  memoriesDismissedOn: string | null;
  setMemoriesDismissedOn: (date: string | null) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  folderDrawerOpen: boolean;
  setFolderDrawerOpen: (open: boolean) => void;
  toggleFolderDrawer: () => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  theme: ThemePref;
  setTheme: (t: ThemePref) => void;

  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;

  /** 人物详情照片墙是否框出当前人物的人脸，默认关闭。 */
  showPersonFaceBoxes: boolean;
  setShowPersonFaceBoxes: (v: boolean) => void;

  /**
   * 是否配置了多个媒体根。只有多根时卡片才显示「来自 X」来源标记——
   * 单一根下每张卡片都挂同一句来源纯属噪音。
   */
  multiRoot: boolean;
  setMultiRoot: (v: boolean) => void;

  /**
   * 是否有一个沉浸浮层正开着（照片墙的大图预览）。
   * 浮层自己处理方向键与缩放，全局单键必须让位，
   * 否则按 r 会一边旋转一边跳走整页。
   * 它不进 localStorage：刷新后浮层早没了。
   */
  immersiveOverlay: boolean;
  setImmersiveOverlay: (v: boolean) => void;

  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id" | "ttl"> & { ttl?: number }) => string;
  dismissToast: (id: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      memoriesDismissedOn: null,
      setMemoriesDismissedOn: (memoriesDismissedOn) =>
        set({ memoriesDismissedOn }),
      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      toggleCommandPalette: () =>
        set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
      folderDrawerOpen: false,
      setFolderDrawerOpen: (open) => set({ folderDrawerOpen: open }),
      toggleFolderDrawer: () =>
        set((s) => ({ folderDrawerOpen: !s.folderDrawerOpen })),

      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      theme: "system",
      setTheme: (t) => set({ theme: t }),

      viewMode: "grid",
      setViewMode: (v) => set({ viewMode: v }),

      showPersonFaceBoxes: false,
      setShowPersonFaceBoxes: (v) => set({ showPersonFaceBoxes: v }),

      multiRoot: false,
      setMultiRoot: (v) => set({ multiRoot: v }),

      immersiveOverlay: false,
      setImmersiveOverlay: (v) => set({ immersiveOverlay: v }),


      toasts: [],
      pushToast: (t) => {
        const id = Math.random().toString(36).slice(2, 10);
        const toast: Toast = {
          id,
          kind: t.kind,
          message: t.message,
          ttl: t.ttl ?? 2800,
          action: t.action,
        };
        set({ toasts: [...get().toasts.slice(-2), toast] });
        if (toast.ttl > 0) {
          setTimeout(() => get().dismissToast(id), toast.ttl);
        }
        return id;
      },
      dismissToast: (id) =>
        set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    }),
    {
      name: "local-gallery-ui",
      version: 3,
      migrate: (persisted, version) => {
        const old =
          typeof persisted === "object" && persisted !== null
            ? (persisted as Record<string, unknown>)
            : {};
        return {
          sidebarCollapsed: old.sidebarCollapsed === true,
          theme:
            old.theme === "light" || old.theme === "dark"
              ? old.theme
              : "system",
          viewMode: old.viewMode === "list" ? "list" : "grid",
          showPersonFaceBoxes: old.showPersonFaceBoxes === true,
          folderDrawerOpen: version >= 2 && old.folderDrawerOpen === true,
          memoriesDismissedOn: null,
        } as Pick<
          UIState,
          | "sidebarCollapsed"
          | "theme"
          | "viewMode"
          | "showPersonFaceBoxes"
          | "folderDrawerOpen"
          | "memoriesDismissedOn"
        >;
      },
      partialize: (s) => ({
        memoriesDismissedOn: s.memoriesDismissedOn,
        folderDrawerOpen: s.folderDrawerOpen,
        sidebarCollapsed: s.sidebarCollapsed,
        theme: s.theme,
        viewMode: s.viewMode,
        showPersonFaceBoxes: s.showPersonFaceBoxes,
      }),
    },
  ),
);
