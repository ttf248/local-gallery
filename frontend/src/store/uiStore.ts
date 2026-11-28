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

export type SidebarState = "expanded" | "collapsed";
export interface PersistedUIPrefs { theme: ThemePref;sidebar:SidebarState;viewMode: ViewMode;showPersonFaceBoxes:boolean;folderDrawerOpen:boolean;inspectorOpen:boolean;memoriesDismissedOn:string|null;memoriesCollapsed:boolean; }
export interface UIState extends PersistedUIPrefs {
  setMemoriesCollapsed:(value:boolean)=>void;
  setMemoriesDismissedOn: (date: string | null) => void;
  commandSeed?: string;
  commandPaletteOpen: boolean;
  commandScope?: "name" | "content";
  setCommandPaletteOpen: (open: boolean, scope?: "name" | "content", seed?:string) => void;
  toggleCommandPalette: () => void;
  setFolderDrawerOpen: (open: boolean) => void;
  toggleFolderDrawer: () => void;

  setInspectorOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebar: (value: SidebarState) => void;

  setTheme: (t: ThemePref) => void;

  setViewMode: (v: ViewMode) => void;

  /** 人物详情照片墙是否框出当前人物的人脸，默认关闭。 */
  setShowPersonFaceBoxes: (v: boolean) => void;

  /**
   * 是否配置了多个媒体根。只有多根时卡片才显示「来自 X」来源标记——
   * 单一根下每张卡片都挂同一句来源纯属噪音。
   */
  multiRootByMode: { photo: boolean; comic: boolean };
  setMultiRoot: (v: { photo: boolean; comic: boolean }) => void;

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
      memoriesCollapsed:false,setMemoriesCollapsed:memoriesCollapsed=>set({memoriesCollapsed}),
      memoriesDismissedOn: null,
      setMemoriesDismissedOn: (memoriesDismissedOn) =>
        set({ memoriesDismissedOn }),
      commandPaletteOpen: false,
      setCommandPaletteOpen: (open, scope, seed) =>
        set({ commandPaletteOpen: open, commandScope: scope, commandSeed: seed }),
      toggleCommandPalette: () =>
        set((s) => ({
          commandPaletteOpen: !s.commandPaletteOpen, commandSeed: undefined,
          commandScope: undefined,
        })),
      folderDrawerOpen: false,
      setFolderDrawerOpen: (open) => set({ folderDrawerOpen: open }),
      toggleFolderDrawer: () =>
        set((s) => ({ folderDrawerOpen: !s.folderDrawerOpen })),

      sidebar: "expanded",
      inspectorOpen: false,
      setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
      toggleSidebar: () =>
        set((s) => ({
          sidebar: s.sidebar === "expanded" ? "collapsed" : "expanded",
        })),
      setSidebar: (sidebar) => set({ sidebar }),

      theme: "system",
      setTheme: (t) => set({ theme: t }),

      viewMode: "grid",
      setViewMode: (v) => set({ viewMode: v }),

      showPersonFaceBoxes: false,
      setShowPersonFaceBoxes: (v) => set({ showPersonFaceBoxes: v }),

      multiRootByMode: { photo: false, comic: false },
      setMultiRoot: (v) => set({ multiRootByMode: v }),

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
      version: 5,
      migrate: (persisted, version) => {
        const old =
          typeof persisted === "object" && persisted !== null
            ? (persisted as Record<string, unknown>)
            : {};
        return {
          memoriesCollapsed:old.memoriesCollapsed===true,
          sidebar: (version>=4?old.sidebar==="collapsed":old.sidebarCollapsed===true) ? "collapsed" : "expanded",
          inspectorOpen: version>=4 && old.inspectorOpen===true,
          theme:
            old.theme === "light" || old.theme === "dark"
              ? old.theme
              : "system",
          viewMode: old.viewMode === "list" ? "list" : "grid",
          showPersonFaceBoxes: old.showPersonFaceBoxes === true,
          folderDrawerOpen: version >= 2 && old.folderDrawerOpen === true,
          memoriesDismissedOn:
            typeof old.memoriesDismissedOn === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(old.memoriesDismissedOn)
              ? old.memoriesDismissedOn
              : null,
        } as Pick<
          UIState,
          | "sidebar"
          | "inspectorOpen"
          | "theme"
          | "viewMode"
          | "showPersonFaceBoxes"
          | "folderDrawerOpen"
          | "memoriesDismissedOn"
        >;
      },
      partialize: (s) => ({
        memoriesCollapsed:s.memoriesCollapsed,
        memoriesDismissedOn: s.memoriesDismissedOn,
        folderDrawerOpen: s.folderDrawerOpen,
        sidebar: s.sidebar,
        inspectorOpen: s.inspectorOpen,
        theme: s.theme,
        viewMode: s.viewMode,
        showPersonFaceBoxes: s.showPersonFaceBoxes,
      }),
    },
  ),
);
