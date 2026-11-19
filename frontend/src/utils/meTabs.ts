import type { AppMode } from "../api/library";

/**
 * 「我的」页的页签。
 *
 * 两侧的页签不同：照片侧有一项照片级的精选，漫画侧没有；漫画侧有一项
 * 阅读状态，照片侧没有。页签 id 进 URL（`/photo/me/picks`），切页签是一次
 * 普通导航，深链能直接落到某一页签。
 */
export interface MeTab {
  /** 稳定 id：同时是路由段。 */
  id: string;
  /** 页签上的名字。 */
  label: string;
  /** 这一页要讲清楚的一句话，说明它与别的页签差在哪。 */
  hint: string;
}

export const PHOTO_ME_TABS: MeTab[] = [
  {
    id: "picks",
    label: "精选照片",
    hint: "一张一张挑出来的照片",
  },
  {
    id: "favorites",
    label: "收藏",
    hint: "值得留着的相册、集合与标签",
  },
  {
    id: "recents",
    label: "最近浏览",
    hint: "我刚才在翻哪几本",
  },
];

export const COMIC_ME_TABS: MeTab[] = [
  {
    id: "favorites",
    label: "收藏",
    hint: "值得留着的作品、卷与标签",
  },
  {
    id: "recents",
    label: "最近阅读",
    hint: "我刚才在读哪几卷",
  },
  {
    id: "reading",
    label: "在读",
    hint: "读到一半、还没读完的卷",
  },
];

/** 某个工作台的「我的」页签。 */
export function meTabsFor(mode: AppMode): MeTab[] {
  return mode === "comic" ? COMIC_ME_TABS : PHOTO_ME_TABS;
}

/**
 * 解析地址里的页签 id。
 *
 * 认不出的值回落到第一个页签，不报错：地址是用户能直接改的地方，
 * 改错了不该让整页空白。
 */
export function resolveMeTab(mode: AppMode, tabId: string | undefined): MeTab {
  const tabs = meTabsFor(mode);
  return tabs.find((tab) => tab.id === tabId) ?? tabs[0];
}
