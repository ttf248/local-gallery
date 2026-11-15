/**
 * 页面内页签的清单。
 *
 * 设置页与任务中心各有一排页签，页签的 id 同时是 URL 路径段
 * （`/settings/interface`、`/tasks/plan`）：切页签是一次普通导航，
 * 浏览器前进后退能跨页签，深链也能直接分享。
 *
 * 这份清单是页签的唯一来源 —— 页签条、页面面板、浏览器标题与侧栏上的
 * 「当前在哪一段」都从它出，两处的说法不会对不上。
 */

export interface PageTabDef {
  /** 稳定 id：同时是路由段。 */
  id: string;
  label: string;
}

export interface TabbedPage {
  /** 路径前缀：`/settings`、`/tasks`。 */
  base: string;
  /** 缺省页签。 */
  defaultTab: string;
  tabs: PageTabDef[];
}

/**
 * 设置页的页签。
 *
 * 分组按业务逻辑，不按控件类型：「外观 + 导航」都是应用长什么样，
 * 「数据 + 备份」都是本机存了什么，「服务端」是机器怎么跑。
 */
export const SETTINGS_TABS: PageTabDef[] = [
  { id: "interface", label: "界面" },
  { id: "reading", label: "阅读" },
  { id: "data", label: "数据" },
  { id: "server", label: "服务端" },
];

/**
 * 任务中心的页签。
 *
 * 四段是四类不同形状的东西：实时控制台、定时表单、历史日志、库存盘点。
 * 每日计划排在任务记录之前 —— 计划是要经常调的设置，记录是事后看的日志。
 */
export const TASK_TABS: PageTabDef[] = [
  { id: "run", label: "运行" },
  { id: "plan", label: "每日计划" },
  { id: "history", label: "任务记录" },
  { id: "storage", label: "本机存储" },
];

export const TAB_PAGES: Record<string, TabbedPage> = {
  settings: {
    base: "/settings",
    defaultTab: "interface",
    tabs: SETTINGS_TABS,
  },
  tasks: { base: "/tasks", defaultTab: "run", tabs: TASK_TABS },
};

/** 路径落在哪个带页签的页面上；不在就返回 null。 */
export function tabbedPageFor(pathname: string): TabbedPage | null {
  const segment = pathname.split("/")[1] ?? "";
  return TAB_PAGES[segment] ?? null;
}

/** 当前页签的 id；缺失或不认识都回落到缺省页签。 */
export function resolveTab(page: TabbedPage, tabId: string | undefined): string {
  if (tabId && page.tabs.some((tab) => tab.id === tabId)) return tabId;
  return page.defaultTab;
}

/** 当前页签的名字：给浏览器标题与侧栏用。 */
export function tabLabelFor(pathname: string): string | undefined {
  const page = tabbedPageFor(pathname);
  if (!page) return undefined;
  const tabId = pathname.split("/")[2];
  return page.tabs.find((tab) => tab.id === resolveTab(page, tabId))?.label;
}

/** 页签路由：`/settings/interface`。 */
export function tabRoute(page: TabbedPage, tabId: string): string {
  return `${page.base}/${tabId}`;
}

/**
 * 当前所在页签的完整路由。
 *
 * 侧栏用它指路：已经站在这一页时再点它的入口，不该把页签打回缺省那个。
 * 不在带页签的页面上返回 null。
 */
export function currentTabRoute(pathname: string): string | null {
  const page = tabbedPageFor(pathname);
  if (!page) return null;
  const tabId = pathname.split("/")[2];
  return tabRoute(page, resolveTab(page, tabId));
}
