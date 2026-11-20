import type {
  AppMode,
  LibraryListQuery,
  MediaFeedQuery,
} from "./library";

/**
 * 查询键注册表。
 *
 * 查询键是缓存的身份：同一个键就是同一份数据。键散落在各处各拼各的，
 * 「刷新列表」就不知道该失效哪些 —— 手抄一遍字符串，漏一个就有一条
 * 旧数据留在界面上。所以键只有这一处定义。
 *
 * 这里只放键，不放取数函数：取数函数属于各自的 api 模块，测试替换那
 * 一层时不必连带替换这里。
 */

/** 服务端偏好（主题、自动切换下一本、侧栏折叠等）。 */
export const prefsQueryKey = ["prefs"] as const;

/** 收藏列表。收藏只有这一份缓存。 */
export const favoritesQueryKey = ["favorites"] as const;

/** 最近访问。 */
export const historyQueryKey = ["history"] as const;

/**
 * 媒体库相关的查询键。
 */
export const libraryQueryKeys = {
  root: ["library"] as const,
  /**
   * 模式维度。列表型查询都带上模式：切换工作台等于换一组查询键，
   * React Query 会自动去拉新数据，旧模式的缓存留着，切回来是秒开。
   */
  mode: (mode: AppMode) => [...libraryQueryKeys.root, "mode", mode] as const,
  // 与模式无关：切模式不重取。
  manifest: () => [...libraryQueryKeys.root, "manifest"] as const,
  /**
   * 相册里的媒体。
   *
   * filterKey 是筛选条件的标记：筛选与否是两份不同的数据，
   * 换筛选就是换一份查询键，React Query 自动去拉新数据。
   */
  media: (albumId: string, filterKey = "") =>
    [...libraryQueryKeys.root, "media", albumId, filterKey] as const,
  /**
   * 一本相册里真实可用的筛选条件。
   */
  albumFilters: (albumId: string) =>
    [...libraryQueryKeys.root, "album-filters", albumId] as const,
  nodes: (ids: string[]) =>
    [...libraryQueryKeys.root, "nodes", ...ids] as const,
  // 与模式相关。
  activitySummary: (mode: AppMode) =>
    [...libraryQueryKeys.mode(mode), "activity-summary"] as const,
  dashboard: (mode: AppMode) =>
    [...libraryQueryKeys.mode(mode), "dashboard"] as const,
  unreadAlbums: (mode: AppMode) =>
    [...libraryQueryKeys.mode(mode), "unread-albums"] as const,
  children: (parentId: string, mode: AppMode) =>
    [...libraryQueryKeys.mode(mode), "children", parentId] as const,
  /** 目录树里按名字定位：一次列出命中的文件夹与相册。 */
  treeSearch: (mode: AppMode, query: string) =>
    [...libraryQueryKeys.mode(mode), "tree-search", query] as const,
  tags: (mode: AppMode) => [...libraryQueryKeys.mode(mode), "tags"] as const,
  tagAlbums: (tag: string, mode: AppMode) =>
    [...libraryQueryKeys.mode(mode), "tag-albums", tag] as const,
  /**
   * 目录列表。query 里带着筛选与排序，整份进键 —— 换筛选就是换一份数据。
   */
  list: (query: LibraryListQuery) =>
    [...libraryQueryKeys.mode(query.kind), "list", query] as const,
  /**
   * 跨相册的照片流。键的形状与列表一致，两者在失效时可以一起处理。
   */
  feed: (query: MediaFeedQuery) =>
    [...libraryQueryKeys.mode(query.kind), "feed", query] as const,
};

/**
 * 判断一个查询键是不是「按最近看」排序的目录列表。
 *
 * 只有这种列表会随访问历史变化：排序依据是打开时间，不是目录里的字段。
 * 历史一变就要重取，否则列表还停在旧的顺序上。
 *
 * 认的是键的形状而不是把键序列化成字符串再搜 —— 后者一旦字段值里凑巧
 * 出现同样的字就会误伤。
 */
export function isViewedListQueryKey(key: readonly unknown[]): boolean {
  if (key[0] !== "library" || key[3] !== "list") return false;
  const query = key[4];
  return (
    typeof query === "object" &&
    query !== null &&
    (query as { sort?: unknown }).sort === "viewed"
  );
}

/** 阅读活动：单个相册。 */
export const activityQueryKey = (albumId: string) =>
  ["activity", "image", albumId] as const;

/**
 * 阅读活动：一批相册。
 *
 * 键只到这一层：各批的相册 ID 不同，键也就不同；按前缀失效可以一次
 * 覆盖所有批次。
 */
export const activityBatchQueryKey = ["activity-query", "image"] as const;

/**
 * 阅读活动变化后要失效的查询键。
 *
 * 这些查询的结果里带着「读到哪一页」：摘要、仪表盘、未读清单、目录列表
 * 与照片流的进度标记，以及活动本身。
 *
 * 键从注册表派生，不手抄：手抄一遍字符串，漏一个就有一条旧进度留在
 * 界面上 —— 读完一本漫画，列表上的「已读」标记却还在。
 */
export function activityAffectedKeys(): readonly (readonly unknown[])[] {
  return [
    activityBatchQueryKey,
    ["activity", "image"],
    ...(["photo", "comic"] as const).flatMap((mode) => [
      libraryQueryKeys.activitySummary(mode),
      libraryQueryKeys.dashboard(mode),
      libraryQueryKeys.unreadAlbums(mode),
      [...libraryQueryKeys.mode(mode), "list"],
      [...libraryQueryKeys.mode(mode), "feed"],
    ]),
  ];
}
