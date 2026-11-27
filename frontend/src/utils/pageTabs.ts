export type SettingsTabId = "general" | "tasks" | "storage" | "server";

export interface PageTabDef<T extends string = string> {
  id: T;
  label: string;
}

export interface TabbedPage<T extends string = string> {
  base: string;
  defaultTab: T;
  tabs: readonly PageTabDef<T>[];
}

export const SETTINGS_TABS: readonly PageTabDef<SettingsTabId>[] = [
  { id: "general", label: "通用与阅读" },
  { id: "tasks", label: "分析与计划" },
  { id: "storage", label: "数据与存储" },
  { id: "server", label: "媒体库与服务" },
];

export const TAB_PAGES = {
  settings: { base: "/settings", defaultTab: "general", tabs: SETTINGS_TABS },
} as const;

export const LEGACY_SETTINGS_TAB_REDIRECTS = [
  { from: "/settings", to: "/settings/general" },
  { from: "/settings/interface", to: "/settings/general" },
  { from: "/settings/reading", to: "/settings/general", hash: "reading" },
  { from: "/settings/data", to: "/settings/storage" },
  { from: "/tasks", to: "/settings/tasks" },
  { from: "/tasks/run", to: "/settings/tasks" },
  { from: "/tasks/plan", to: "/settings/tasks", hash: "daily-plan" },
  { from: "/tasks/history", to: "/settings/tasks", hash: "task-history" },
  { from: "/tasks/storage", to: "/settings/storage" },
  { from: "/tasks/*", to: "/settings/tasks" },
];

export function resolveTab<T extends string>(page: TabbedPage<T>, tabId?: string): T {
  return page.tabs.find(({ id }) => id === tabId)?.id ?? page.defaultTab;
}

export function tabRoute<T extends string>(page: TabbedPage<T>, tabId: T): string {
  return page.base + "/" + tabId;
}

export function currentTabRoute(pathname: string): string | null {
  const [, section, tab] = pathname.split("/");
  return section === "settings" ? tabRoute(TAB_PAGES.settings, resolveTab(TAB_PAGES.settings, tab)) : null;
}

export function tabLabelFor(pathname: string): string | undefined {
  const route = currentTabRoute(pathname);
  return SETTINGS_TABS.find(({ id }) => route === tabRoute(TAB_PAGES.settings, id))?.label;
}
