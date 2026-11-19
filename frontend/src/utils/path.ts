import type { AppMode } from "../api/library";
import { meTabsFor } from "./meTabs";

/**
 * 工作台路由。
 *
 * 模式进 URL 路径：`/photo` 与 `/comic` 各有一套路由。路径前缀是
 * 「当前在看哪一侧」的唯一真相源；服务端偏好只决定进入根路径时
 * 落到哪一侧。这样切模式就是一次普通导航，浏览器前进后退能跨模式，
 * 深链也能直接分享。
 */
export const MODE_PREFIX: Record<AppMode, string> = {
  photo: "/photo",
  comic: "/comic",
};

const ALBUMS_MARKER = "/albums/";
const TAGS_MARKER = "/tags/";
const READER_PREFIX = "/comic/read/";

/** 路径是否落在漫画阅读器上。阅读器整屏脱离 AppShell。 */
export function isReaderPath(pathname: string): boolean {
  return pathname.startsWith(READER_PREFIX);
}

/**
 * 从路径首段判断当前工作台；不在任何一侧时返回 null。
 *
 * 按段匹配：`/photographs` 不是照片工作台。
 */
export function modeFromPath(pathname: string): AppMode | null {
  const first = pathname.split("/").filter(Boolean)[0];
  if (first === "photo") return "photo";
  if (first === "comic") return "comic";
  return null;
}

/** 工作台首页：照片库 / 漫画库。 */
export function homeRoute(mode: AppMode): string {
  return MODE_PREFIX[mode];
}

/**
 * 图库（照片侧）/ 书架（漫画侧）。
 *
 * 两侧是同一个页面：它按当前媒体根的真实目录层级列出全部相册与集合，
 * 措辞与封面画幅随侧走。
 */
export function libraryRoute(mode: AppMode): string {
  return `${MODE_PREFIX[mode]}/library`;
}

/**
 * 探索页。只属于照片侧：漫画没有时间、人物、地点与主题这些维度，
 * 它的结构浏览就是书架。
 */
export function exploreRoute(): string {
  return `${MODE_PREFIX.photo}/explore`;
}

/**
 * 「我的」页：个人数据（精选 / 收藏 / 最近浏览）。
 *
 * 页签 id 进路径：切页签是一次普通导航，深链能直接落到某一页签。
 */
export function meRoute(mode: AppMode, tab?: string): string {
  const base = `${MODE_PREFIX[mode]}/me`;
  return tab ? `${base}/${tab}` : base;
}

/**
 * 名称搜索结果页。
 *
 * 顶栏的搜索框回车落到这里：结果是一页可见的清单，而不是把关键词塞进
 * 地址后回到一个不显示结果的首页。
 */
export function searchRoute(mode: AppMode): string {
  return `${MODE_PREFIX[mode]}/search`;
}

/**
 * 最近浏览 / 最近阅读。
 *
 * 它住在「我的」的页签里：旧路径（/photo/recents）会重定向过来。
 */
export function recentsRoute(mode: AppMode): string {
  return meRoute(mode, "recents");
}

/** 收藏。资源级标记，可以是相册、集合、作品、卷或标签。 */
export function favoritesRoute(mode: AppMode): string {
  return meRoute(mode, "favorites");
}

/**
 * 精选照片页。
 *
 * 精选只属于照片工作台：它是照片级的挑选，漫画那边有阅读进度与
 * 已读状态，不需要另一套「这一张值得留着」。
 */
export function picksRoute(): string {
  return `${MODE_PREFIX.photo}/picks`;
}

/** 照片侧的 GPS 地点智能相册。 */
/**
 * 足迹页。
 *
 * 地点详情用路径段（区划码是稳定的六位数字），时间区间与归并粒度走
 * 查询参数：它们是筛选，不该占路径。
 */
export function travelsRoute(): string {
  return `${MODE_PREFIX.photo}/travels`;
}

/** 足迹页里的某个地点。 */
export function travelPlaceRoute(adcode: number): string {
  return `${MODE_PREFIX.photo}/travels/place/${adcode}`;
}

/** 照片侧的人物候选分组相册。 */
export function peopleRoute(personId?: string): string {
  const base = `${MODE_PREFIX.photo}/people`;
  return personId ? `${base}/${encodeURIComponent(personId)}` : base;
}

/**
 * 人物标注工作台。
 *
 * 它给本机的人脸识别质量评估准备标注数据：接口只在回环地址开放，
 * 页面本身仍属于照片侧，路径与人物相册放在一起便于查找。
 */
export function peopleAnnotateRoute(): string {
  return `${MODE_PREFIX.photo}/people/annotate`;
}

/** 照片侧的中文语义搜索与以图搜图。 */
export function semanticSearchRoute(): string {
  return `${MODE_PREFIX.photo}/semantic`;
}

/**
 * 随手看看：全库随机抽出的照片墙。
 *
 * 只属于照片工作台：首页那面「随手看看」的照片墙是照片侧的入口，
 * 漫画那边没有对应的东西。
 */
export function randomPhotosRoute(): string {
  return `${MODE_PREFIX.photo}/random`;
}

/**
 * 按年份浏览照片。
 *
 * 年份只属于照片工作台：漫画按作品与卷组织，年份对它没有意义。
 */
export function yearRoute(year: string): string {
  return `${MODE_PREFIX.photo}/years/${encodeURIComponent(year)}`;
}

/**
 * 相似照片与连拍整理。
 *
 * 只属于照片工作台：重复、裁剪改过的副本与连拍都是照片侧的概念，
 * 漫画那边按作品与卷组织，没有这一套。
 */
export function similarityRoute(): string {
  return `${MODE_PREFIX.photo}/similarity`;
}

/**
 * 智能相册：全库已生成的智能分组汇成的一面墙。
 *
 * 只属于照片工作台：分组线索（时间、地点、人物、场景）来自照片的
 * 元数据与人脸分析，漫画那边没有这一套。
 */
export function smartAlbumsRoute(): string {
  return `${MODE_PREFIX.photo}/smart-albums`;
}

/**
 * 未读页只在漫画工作台存在。
 *
 * 它没有模式参数：照片侧根本没有这个页面，路由表里也不注册。
 */
export function unreadRoute(): string {
  return "/comic/unread";
}

/** 相册页：照片侧渲染照片墙，漫画侧重定向到阅读器。 */
export function albumRoute(mode: AppMode, albumId: string): string {
  return `${MODE_PREFIX[mode]}${ALBUMS_MARKER}${encodeURIComponent(albumId)}`;
}

/** 标签页。标签名按单个路径段编码，服务端只解码一次。 */
export function tagRoute(mode: AppMode, tag: string): string {
  return `${MODE_PREFIX[mode]}${TAGS_MARKER}${encodeURIComponent(tag)}`;
}

/**
 * 漫画阅读器：`/comic/read/<相册 id>`。
 *
 * 阅读器只属于漫画侧，因此没有模式参数。
 */
export function readerRoute(albumId: string, index?: number): string {
  const base = `${READER_PREFIX}${encodeURIComponent(albumId)}`;
  return index === undefined ? base : `${base}?index=${index}`;
}

/**
 * 两个工作台各自的页面路径（相对模式前缀）。
 *
 * 子路径自带前导斜杠：完整路径 = 模式前缀 + 子路径。
 * 少了这个斜杠就会拼出 "/photoalbums/*" 这种匹配不上的路径 ——
 * 症状是页面能开首页，点进相册却落回兜底路由。
 *
 * 两侧的清单不同：探索只属于照片侧（漫画没有时间、人物、地点与主题），
 * 其余页面两侧共用同一批组件，差别在数据源与措辞。
 */
export const MODE_ROUTE_PATHS: Record<AppMode, readonly string[]> = {
  photo: [
    "",
    "/library",
    "/explore",
    "/me/:tab",
    "/search",
    "/albums/*",
    "/tags/*",
  ],
  comic: ["", "/library", "/me/:tab", "/search", "/albums/*", "/tags/*"],
};

/**
 * 切到另一侧时该去的页面。
 *
 * 两侧都有对应物的页面（图库 / 搜索 / 标签 / 「我的」的同名页签）一一搬
 * 过去；只属于一侧的（相册、阅读器、未读、精选）回落到目标侧首页。
 * 这张表是「模式切换」唯一的语义来源，侧栏开关与阅读器顶栏共用它。
 */
export function counterpartRoute(pathname: string, target: AppMode): string {
  const current = modeFromPath(pathname);
  if (!current) return homeRoute(target);
  if (current === target) return pathname;
  const rest = pathname.slice(MODE_PREFIX[current].length) || "/";
  // 图库与搜索两侧同名：照片侧叫图库，漫画侧叫书架，同一个页面。
  if (rest === "/library" || rest === "/search") {
    return `${MODE_PREFIX[target]}${rest}`;
  }
  // 「我的」的页签按名字搬：两侧都有 favorites / recents；
  // 精选只在照片侧、在读只在漫画侧，对不上就回落到目标侧首页。
  if (rest.startsWith("/me")) {
    const tabId = rest.slice("/me".length).replace(/^\//, "");
    const tabs = meTabsFor(target);
    const tab = tabs.find((t) => t.id === tabId);
    return tab ? meRoute(target, tab.id) : homeRoute(target);
  }
  // 标签段原样搬过去：它可能含字面 %xx，重新编码会破坏语义。
  if (rest.startsWith(TAGS_MARKER)) {
    return `${MODE_PREFIX[target]}${rest}`;
  }
  return homeRoute(target);
}

/**
 * 从原始路径里切出标记之后的整段，并解码一次。
 *
 * 路径段只解码一次：React Router 的 useParams 已经解过一次，再解会把
 * 标签名里的字面 `%xx` 破坏掉。因此一律从原始 pathname 切段。
 */
export function decodePathTail(pathname: string, marker: string): string {
  const index = pathname.indexOf(marker);
  if (index < 0) return "";
  const raw = pathname.slice(index + marker.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

/**
 * 从相册路由提取不透明资源 ID。
 *
 * 资源 ID 形如 `a_xxx` / `c_xxx`，不含路径分隔符，因此从串里找
 * "/albums/" 标记即可，不必关心前面是哪个工作台前缀。
 */
export function decodeFavPath(to: string): string {
  const index = to.indexOf(ALBUMS_MARKER);
  if (index < 0) return to;
  const raw = to.slice(index + ALBUMS_MARKER.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 收藏用的资源 ID：智能集合用 smart: 前缀，其余用收藏路径。
 * 卡片星标、右键菜单和收藏页必须用同一套 ID，否则收藏会互相看不见。
 */
export function favoriteResourceId(item: {
  variant?: string;
  title: string;
  to: string;
}): string {
  return item.variant === "smart"
    ? `smart:${item.title}`
    : decodeFavPath(item.to);
}

/**
 * 错误边界的重置键。
 *
 * 路由层用路径当 key：路径一变，整页重挂，渲染出错时兜底一次就干净。
 * 但设置页与任务中心的页签也在路径里（`/settings/data`），切页签不该
 * 重挂整页 —— 任务中心里已选的分析模块与没保存的每日计划草稿都在页面
 * 状态里，重挂一次就丢了。
 *
 * 因此只把这几页的子路径折叠成同一个 key，其余路径一字不动：相册页
 * 之间仍然逐页重挂（换相册就是换一份数据）。「我的」的页签也在路径里
 * （`/photo/me/picks`），切页签同样不该重挂整页。
 */
export function pageBoundaryKey(pathname: string): string {
  const segment = pathname.split("/")[1] ?? "";
  if (segment === "settings" || segment === "tasks" || segment === "me") {
    return segment;
  }
  return pathname;
}
