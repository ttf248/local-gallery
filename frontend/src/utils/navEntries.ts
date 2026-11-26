import {
  CompassIcon,
  CopyIcon,
  HomeIcon,
  ImageIcon,
  LibraryIcon,
  SparkleIcon,
  TasksIcon,
  SettingsIcon,
  UserIcon,
} from "../ui/icons";
import {
  exploreRoute,
  homeRoute,
  libraryRoute,
  meRoute,
  similarityRoute,
  unreadRoute,
} from "./path";
import type { AppMode } from "../api/library";

/**
 * 侧栏导航项的目录。
 *
 * 这是导航项的唯一一份清单：侧栏按它渲染，设置页的「导航」分区也按它
 * 逐项开关。两处共用一份，就不会出现侧栏写着「精选照片」而设置页里
 * 叫「精选」的情况。
 *
 * 侧栏按**分组**呈现，而不是一长串平铺入口：
 *
 * - 内容组（照片 / 漫画）：这一侧的主导航 —— 照片侧是照片、相册、发现、
 *   珍藏，漫画侧是首页、书架、我的、未读。
 * - 整理组：相似照片这类写操作，是次级入口，不与主导航混在一列。
 * - 本机组：任务中心与设置。它们不属于任何一侧，排在所有内容入口之后。
 *
 * 侧栏只呈现当前工作台的那一组。两个模式是完全独立的界面：照片这边
 * 只有浏览、收藏与最近；漫画这边才有未读与继续阅读。菜单不混排，
 * 操作也不互相沾边。两组的路径也各属一侧（/photo/… 与 /comic/…）：
 * 菜单项不是同一个页面换了个名字，而是两套互不相干的路由。
 */
export interface NavEntry {
  /** 稳定 id：写入服务端偏好，跨版本不能变。 */
  key: string;
  label: string;
  Icon: typeof HomeIcon;
  /** 路由路径。 */
  to: string;
  /** 所属工作台。本机组的条目不属于任何一侧。 */
  mode?: AppMode;
  /**
   * 固定显示：工作台首页不可收起。
   *
   * 首页是那一侧的落点，收起它就没有任何一个入口留在侧栏里了。
   */
  locked?: boolean;
}

/** 侧栏的一组入口。 */
export interface NavGroup {
  /** 稳定 id：分组名也进服务端偏好吗？不进 —— 只有条目可收起。 */
  key: string;
  /** 分组名（折叠态不显示）。 */
  label: string;
  entries: NavEntry[];
}

export const PHOTO_NAV: NavEntry[] = [
  {
    key: "photo.home",
    label: "照片",
    // 这一项摆的是照片，图标也跟着说照片：旁边三项的图标都是内容
    // 类型的（相册 / 探索 / 我的），唯独这一项挂个房子，读起来像
    // 「首页」没改名。
    Icon: ImageIcon,
    to: homeRoute("photo"),
    mode: "photo",
    locked: true,
  },
  {
    key: "photo.library",
    label: "相册",
    Icon: LibraryIcon,
    to: libraryRoute("photo"),
    mode: "photo",
  },
  {
    key: "photo.explore",
    label: "发现",
    Icon: CompassIcon,
    to: exploreRoute(),
    mode: "photo",
  },
  {
    key: "photo.me",
    label: "珍藏",
    Icon: UserIcon,
    to: meRoute("photo"),
    mode: "photo",
  },
  {
    key: "photo.organize",
    label: "相似照片",
    Icon: CopyIcon,
    to: similarityRoute(),
    mode: "photo",
  },
];

export const COMIC_NAV: NavEntry[] = [
  {
    key: "comic.home",
    label: "首页",
    Icon: HomeIcon,
    to: homeRoute("comic"),
    mode: "comic",
    locked: true,
  },
  {
    key: "comic.library",
    label: "书架",
    Icon: LibraryIcon,
    to: libraryRoute("comic"),
    mode: "comic",
  },
  {
    key: "comic.me",
    label: "我的",
    Icon: UserIcon,
    to: meRoute("comic"),
    mode: "comic",
  },
  {
    key: "comic.unread",
    label: "未读",
    Icon: SparkleIcon,
    to: unreadRoute(),
    mode: "comic",
  },
];

/**
 * 侧栏分组。
 *
 * 照片侧：浏览（照片 / 相册 / 发现 / 珍藏）+ 整理（相似照片）+ 本机。
 * 漫画侧：漫画（首页 / 书架 / 我的 / 未读）+ 本机。
 *
 * 照片侧的主分组不叫「照片」：里面第一项就是「照片」，分组名与条目名
 * 撞在一起，窄栏里读起来像同一个词出现了两遍。
 */
export const PHOTO_NAV_GROUPS: NavGroup[] = [
  { key: "photo.main", label: "浏览", entries: PHOTO_NAV.slice(0, 4) },
  { key: "photo.organize", label: "整理", entries: PHOTO_NAV.slice(4) },
];

export const COMIC_NAV_GROUPS: NavGroup[] = [
  { key: "comic.main", label: "漫画", entries: COMIC_NAV },
];

/**
 * 本机组：任务中心与设置。
 *
 * 它们不属于当前工作台，单独成组，放在浏览组下面 —— 看完照片再管机器
 * 上的事，顺序不能反。这两项不属于任何一侧，也不在设置页的开关范围
 * 内。
 */
export const MACHINE_GROUP: NavGroup = {
  key: "machine",
  label: "本机",
  entries: [
    {
      key: "machine.tasks",
      label: "任务中心",
      Icon: TasksIcon,
      to: "/tasks",
    },
    {
      key: "machine.settings",
      label: "设置",
      Icon: SettingsIcon,
      to: "/settings",
    },
  ],
};

/**
 * 默认收起的导航项。
 *
 * 新导航只有几个一级入口，全部默认显示：它们各自回答一个不同的问题，
 * 收起任何一个都会让那一类内容少一条路。高级整理（相似照片）仍然在
 * 侧栏里，但单独成组、视觉次级。
 *
 * 这份清单与后端 models.DefaultHiddenNavItems 一一对应，改一处就要改
 * 另一处 —— 服务端存的是生效清单，没有默认值就无法区分「用户没配过」
 * 与「用户把它收起来了」。
 */
export const DEFAULT_HIDDEN_NAV_ITEMS: string[] = [];

/** 某个工作台的导航项。 */
export function navEntriesFor(mode: AppMode): NavEntry[] {
  return mode === "comic" ? COMIC_NAV : PHOTO_NAV;
}

/** 某个工作台的侧栏分组（不含本机组）。 */
export function navGroupsFor(mode: AppMode): NavGroup[] {
  return mode === "comic" ? COMIC_NAV_GROUPS : PHOTO_NAV_GROUPS;
}

/** 某个工作台的入口 key 清单（设置页的「导航」分区按它渲染）。 */
export function navKeysFor(mode: AppMode): string[] {
  return navEntriesFor(mode).map((entry) => entry.key);
}
