import {
  ClockIcon,
  FolderSearchIcon,
  HomeIcon,
  MapPinIcon,
  PeopleIcon,
  PickIcon,
  SparkleIcon,
  StarIcon,
} from "../components/common/Icon";
import {
  favoritesRoute,
  homeRoute,
  peopleRoute,
  picksRoute,
  recentsRoute,
  semanticSearchRoute,
  travelsRoute,
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
  /** 所属工作台。 */
  mode: AppMode;
  /**
   * 固定显示：工作台首页不可收起。
   *
   * 首页是那一侧的落点，收起它就没有任何一个入口留在侧栏里了。
   */
  locked?: boolean;
}

export const PHOTO_NAV: NavEntry[] = [
  { key: "photo.home", label: "照片库", Icon: HomeIcon, to: homeRoute("photo"), mode: "photo", locked: true },
  { key: "photo.recents", label: "最近浏览", Icon: ClockIcon, to: recentsRoute("photo"), mode: "photo" },
  { key: "photo.favorites", label: "收藏照片", Icon: StarIcon, to: favoritesRoute("photo"), mode: "photo" },
  { key: "photo.picks", label: "精选照片", Icon: PickIcon, to: picksRoute(), mode: "photo" },
  { key: "photo.travels", label: "足迹", Icon: MapPinIcon, to: travelsRoute(), mode: "photo" },
  { key: "photo.people", label: "人物相册", Icon: PeopleIcon, to: peopleRoute(), mode: "photo" },
  { key: "photo.semantic", label: "智能搜索", Icon: FolderSearchIcon, to: semanticSearchRoute(), mode: "photo" },
];

export const COMIC_NAV: NavEntry[] = [
  { key: "comic.home", label: "漫画库", Icon: HomeIcon, to: homeRoute("comic"), mode: "comic", locked: true },
  { key: "comic.unread", label: "未读", Icon: SparkleIcon, to: unreadRoute(), mode: "comic" },
  { key: "comic.recents", label: "最近阅读", Icon: ClockIcon, to: recentsRoute("comic"), mode: "comic" },
  { key: "comic.favorites", label: "收藏漫画", Icon: StarIcon, to: favoritesRoute("comic"), mode: "comic" },
];

/**
 * 默认收起的导航项。
 *
 * 照片侧的最近浏览、收藏照片与精选照片默认不出现在侧栏：它们都有更近
 * 的入口（照片墙、首页专区），侧栏留给更少、更常用的入口。
 *
 * 这份清单与后端 models.DefaultHiddenNavItems 一一对应，改一处就要改
 * 另一处 —— 服务端存的是生效清单，没有默认值就无法区分「用户没配过」
 * 与「用户把三项都放出来了」。
 */
export const DEFAULT_HIDDEN_NAV_ITEMS = [
  "photo.recents",
  "photo.favorites",
  "photo.picks",
];

/** 某个工作台的导航项。 */
export function navEntriesFor(mode: AppMode): NavEntry[] {
  return mode === "comic" ? COMIC_NAV : PHOTO_NAV;
}
