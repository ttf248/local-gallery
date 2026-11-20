import { api, ApiError } from "./client";

export const LIBRARY_PAGE_LIMIT = 200;
export const LIBRARY_NODE_BATCH_LIMIT = 500;

/** 媒体目录的内容属性：照片目录还是漫画目录。 */
export type ContentKind = "photo" | "comic";

/**
 * 工作台模式。
 *
 * 目录属性把媒体库分成照片与漫画两半，两半互斥；模式一次只面对其中一半。
 * 没有「全部」这一档：它会让两个模式的菜单互相掺入。
 */
export type AppMode = ContentKind;

export interface LibraryStatistics {
  rootCount: number;
  /** 全库相册总数。它不随工作台模式变化。 */
  albumCount: number;
  /** 按内容属性拆分的相册数。 */
  photoAlbumCount?: number;
  comicAlbumCount?: number;
  /** 按内容属性拆分的集合数：与相册数一一对应。 */
  photoCollectionCount?: number;
  comicCollectionCount?: number;
  collectionCount: number;
  tagCount: number;
  warningCount: number;
}

export interface ScanWarning {
  code: string;
  path?: string;
  message: string;
}

export interface LibraryRootSummary {
  id: string;
  name: string;
  childCount: number;
  /** 该目录的内容属性："photo" / "comic"。 */
  contentKind?: ContentKind;
}

export interface LibraryManifest {
  revision: number;
  scannedAt: string;
  duration: number;
  roots: LibraryRootSummary[];
  statistics: LibraryStatistics;
  warnings?: ScanWarning[];
}

/** 「那年今日」命中的一本相册：摘要 + 命中的那一天。 */
export interface LibraryOnThisDayItem extends LibraryNodeSummary {
  /** 命中的那一天，"YYYY-MM-DD"。 */
  matchedDate: string;
  /**
   * 真正拍于那一天的那一张照片。
   *
   * 它的日期证据是文件名里推断出的拍摄时间：服务端给不出这一张时
   * 这里是空的，界面上就不摆照片 —— 宁可少一张，也不拿相册的通用
   * 封面冒充「那天拍的那张」。
   */
  photo?: LibraryOnThisDayPhoto;
}

/** 「那年今日」命中的那一张照片。 */
export interface LibraryOnThisDayPhoto extends LibraryMediaItem {
  /** 这张照片的拍摄日期，"YYYY-MM-DD"。 */
  date: string;
}

export interface LibraryNodeSummary {
  id: string;
  kind: "album" | "collection";
  name: string;
  displayName: string;
  sourceRoot?: string;
  sourceName?: string;
  coverImage?: string;
  coverImages: string[];
  /**
   * 封面文件的内容版本号，与 coverImage / coverImages 一一对应。
   * 前端把它拼进封面 URL，服务端据此回 immutable，重复打开页面时
   * 封面不用再走网络。
   */
  coverImageVersion?: string;
  coverImageVersions?: string[];
  coverKind?: "image" | "video";
  imageCount?: number;
  videoCount?: number;
  mediaCount?: number;
  albumCount?: number;
  childCount?: number;
  folderSize?: number;
  tags?: string[];
  modTime?: string;
  date?: string;
  dateSource?: "filename" | "folder" | "modified";
  virtual?: boolean;
  hasCustomCover?: boolean;
  /**
   * 虚拟相册（"本目录媒体"）归属目录相对媒体根的路径，如 "2020年"、
   * "2011年/10.1一号公馆"。用于替代同名卡片标题，让用户能分辨归属目录。
   * 普通相册为空。
   */
  location?: string;
  /**
   * 内容属性："photo"（照片）或 "comic"（漫画）。
   * 它继承自所属媒体目录，并决定点击相册后进入哪套交互。
   *
   * 服务端对相册与集合恒给出该值，因此这里不是可选的：
   * 漏设会在编译期暴露，而不是让某本漫画悄悄少一根进度条。
   */
  contentKind: ContentKind;
  /**
   * 所属系列：相册直接上级集合的名字。
   *
   * 漫画常常不以年份命名，按年份分组会把它们全塞进「其他」；
   * 所属系列是漫画侧更自然的分组依据。没有上级集合时为空。
   */
  parentName?: string;
  /**
   * 直接上级集合的资源 ID。
   *
   * 前端据此一路往上拼出面包屑：名字给人看，ID 才能继续往上找。
   */
  parentId?: string;
}

export interface LibraryMediaItem {
  id: string;
  kind: "image" | "video";
  name: string;
  index: number;
  kindIndex: number;
  /** 原始像素宽高；未知时为 0，照片墙据此按真实宽高比排布。 */
  width?: number;
  height?: number;
  /**
   * 文件解码不出来（扩展名说是 JPEG，内容却不是；像素数据还是截断的）。
   *
   * 服务端判定：图片头读不出来当场标，渲染时整张解码失败再补记。
   * 界面上据此显示「无法解码」，而不是留一个破图图标让人猜。
   */
  undecodable?: boolean;
  /**
   * 媒体内容版本号（源文件 mtime + size + 渲染算法版本）。
   * 前端把它拼进渲染图 URL，服务端据此回 immutable。
   */
  version?: string;
  /**
   * 这张照片所属的相似组。折叠时墙上只留代表照片，其余成员收在展开区。
   */
  similarityGroup?: AlbumSimilarityRef;
}

/**
 * 相似组在照片墙上的引用。
 *
 * 照片墙只需要知道「这张属于哪一组、这组在本相册里有几张、代表是谁」，
 * 成员名单在用户点开那一组时才去取。
 */
export interface AlbumSimilarityRef {
  id: string;
  /** exact（完全重复）/ near（近似重复）/ burst（连拍同场景）。 */
  kind: "exact" | "near" | "burst";
  /** 组内照片总数（全库口径）。 */
  size: number;
  /** 全库口径下除代表之外的张数。 */
  redundant: number;
  /** 当前生效的代表照片。 */
  representative: string;
  /** 代表照片是用户指定的。 */
  representativeIsManual: boolean;
  /** 组内落在本相册的张数。 */
  albumSize: number;
  /** 折叠后藏起来的张数（相册内）。 */
  albumHidden: number;
  /** 折叠时留在墙上的那张。 */
  shown: string;
}

/**
 * 原始照片墙的筛选条件。
 *
 * 条件作用在整本相册的数据上：服务端先筛出留下的照片，再按相册的
 * 自然顺序分页。因此结果总数、翻页与大图浏览顺序始终是同一件事。
 */
export interface AlbumFilterQuery {
  /** 拍摄时间区间起点，"YYYY-MM"，左闭。 */
  from?: string;
  /** 拍摄时间区间终点，"YYYY-MM"，右闭。 */
  to?: string;
  /** 只保留出现过这个人物的照片。 */
  personId?: string;
  /** 只保留落在这个行政区（含下级）里的照片。 */
  adcode?: number;
  /** 精选口径："only" 只看精选，"none" 只看未精选。 */
  picks?: "only" | "none";
  /** 画面口径："groupPhoto" 只看合照，"similar" 只看相似照片。 */
  scene?: "groupPhoto" | "similar";
  /** 折叠相似组：墙上只留每组的代表照片。 */
  collapse?: boolean;
  /** 展开的那一组：它的成员不再折叠，就地摆在墙上。 */
  expand?: string;
}

/** 一页相册照片墙上因缺少依据而没能参与筛选的数量。 */
export interface AlbumFilterUnresolved {
  captureTime: number;
  location: number;
  face: number;
  /** 去重后的总数：三个分项会重叠。 */
  total: number;
}

/** 相册照片墙的一页。 */
export interface AlbumMediaPage extends LibraryPage<LibraryMediaItem> {
  /** 这一页是筛选后的结果。 */
  filtered: boolean;
  /** 这本相册的媒体总数（筛选前）。 */
  albumTotal: number;
  /** 这本相册里的视频数：视频不参与分析类筛选。 */
  videoTotal: number;
  /** 筛选后留下的照片张数（不含视频）：整份结果，不是这一页。 */
  photoTotal: number;
  /** 因缺少依据而没能参与筛选的照片数。 */
  unresolved: AlbumFilterUnresolved;
  /** 折叠后藏起来的照片数。 */
  grouped: number;
  /** 被折叠的相似组数。 */
  groupedGroups: number;
}

/**
 * 相册照片墙这一页的附加信息。
 *
 * 智能分组那一页也是「相册里的一段照片」，但它没有这些数字；
 * 读不到时按零算 —— 那一段界面上根本不显示。
 */
export function albumPageExtras(page: unknown): {
  filtered: boolean;
  albumTotal: number;
  videoTotal: number;
  photoTotal: number;
  unresolved: AlbumFilterUnresolved;
  grouped: number;
  groupedGroups: number;
} {
  const value = (page ?? {}) as Partial<AlbumMediaPage>;
  return {
    filtered: value.filtered ?? false,
    albumTotal: value.albumTotal ?? 0,
    videoTotal: value.videoTotal ?? 0,
    photoTotal: value.photoTotal ?? 0,
    unresolved: value.unresolved ?? {
      captureTime: 0,
      location: 0,
      face: 0,
      total: 0,
    },
    grouped: value.grouped ?? 0,
    groupedGroups: value.groupedGroups ?? 0,
  };
}

/** 一本相册里真实可用的筛选条件。 */
export interface AlbumFilterFacets {
  total: number;
  videos: number;
  time: {
    available: boolean;
    reason?: string;
    months: { month: string; count: number }[];
    analyzedCount: number;
    unresolvedCount: number;
  };
  people: {
    available: boolean;
    reason?: string;
    items: { id: string; name: string; count: number; confirmed: boolean }[];
    analyzedCount: number;
  };
  places: {
    available: boolean;
    reason?: string;
    items: { adcode: number; name: string; level: string; count: number }[];
    locatedCount: number;
  };
  picks: { pickedCount: number };
  groupPhotos: { available: boolean; reason?: string; count: number };
  similarity: {
    available: boolean;
    reason?: string;
    groupCount: number;
    photoCount: number;
    stale: boolean;
  };
}

/**
 * 跨相册的照片条目：媒体字段 + 它来自哪本相册。
 *
 * 年份墙、精选墙上的照片来自不同的本，用户要看得见出处、也回得去
 * 原来的位置 —— 只给文件 ID 说不出「这张是从哪儿来的」。
 */
export interface LibraryFeedItem extends LibraryMediaItem {
  albumId: string;
  albumName: string;
  /** 时间线上的时间（RFC3339）。没有时间证据时为空。 */
  capturedAt?: string;
  /** 这个时间的来源：exif / filename / folder / modified。 */
  dateSource?: TimelineDateSource;
}

/** 时间的来源。 */
export type TimelineDateSource = "exif" | "filename" | "folder" | "modified";

/** 照片流里一本相册的定位：这些照片来自哪几本。 */
export interface LibraryFeedAlbum {
  id: string;
  name: string;
  /** 这本相册贡献的照片数。 */
  count: number;
}

/**
 * 照片流的取材范围。
 *
 * - year：某一年下各相册的照片（年份是浏览入口）
 * - collection：某个集合内部的照片
 * - recent / random：几本相册的照片交错排在一起
 */
export type MediaFeedScope =
  | "recent"
  | "random"
  | "year"
  | "collection"
  /** 随机长流：瀑布流专页往下滑的数据源，按游标一页页往下取。 */
  | "stream"
  /**
   * 时间线：全库照片按拍摄证据排成的一条序列。
   *
   * 它是照片工作台的默认视图：一页一页往下取就是顺着时间往回走。
   */
  | "timeline";

export interface MediaFeedQuery {
  kind: AppMode;
  scope: MediaFeedScope;
  /** scope=year 时必填："1900".."2099" 或 "other"。 */
  year?: string;
  /** scope=collection 时必填：集合的资源 ID。 */
  parent?: string;
  /**
   * scope=random 时的取材种子。
   *
   * 同一个种子给同一批照片，不同种子给不同的批次 —— 「换一批」因此
   * 一定换得掉，而不是碰运气看服务端抽到哪几本。
   */
  seed?: string;
  /**
   * scope=timeline 时：月份，"1".."12"。
   *
   * 月份只在年份之内有意义，因此必须与 year 同时给 —— 只给月份时服务端
   * 拒绝这个请求，而不是猜一个年份。
   */
  month?: string;
  /**
   * scope=timeline 时：媒体类型，"photo" / "video"。
   *
   * 缺省是两类都收。
   */
  media?: string;
}

/**
 * 取材范围里被选中的节点。
 *
 * 年份对应的那几个集合：年份页靠它说清「这一年的照片来自哪里」，
 * 也给出回到那个集合的入口。
 */
export interface LibraryFeedSource {
  id: string;
  name: string;
  kind: "album" | "collection";
}

export interface LibraryFeedPage extends LibraryPage<LibraryFeedItem> {
  albums: LibraryFeedAlbum[];
  sources: LibraryFeedSource[];
  /**
   * 时间线的年份索引：跳年跳月用。
   *
   * 它描述整条时间线，不随已加载页数变化 —— 跳到哪一年，界面上要能
   * 一次列出所有年份与它们的数量。
   */
  years?: TimelineYear[];
  /**
   * 时间线里「日期未知」的媒体数：只有文件修改时间的那部分。
   *
   * 它们不在任何一年里，也拿不到月份 —— 界面要单独摆出来，不能塞进
   * 某一年冒充那年的照片。
   */
  unknown?: number;
  /**
   * 这一段筛选结果里的时间来源分布。
   *
   * 它按整段结果算，不只算当前页：界面上要说明「这一屏看到的时间都是
   * 怎么来的」。
   */
  dateSources?: Partial<Record<TimelineDateSource, number>>;
}

/** 时间线上的一年：照片数与月份分布。 */
export interface TimelineYear {
  year: number;
  count: number;
  months: { month: number; count: number }[];
}

export interface LibraryTagSummary {
  tag: string;
  albumCount: number;
  coverImage?: string;
  coverImages: string[];
  /** 封面内容版本号，与 coverImage / coverImages 一一对应。 */
  coverImageVersion?: string;
  coverImageVersions?: string[];
  /**
   * 该标签在两种属性下的册数。
   * 列表接口按当前属性收敛，只要一个数就够；按名解析时两个都要，
   * 客户端据此判断「这个标签失效了」还是「它只属于另一侧」。
   */
  photoAlbumCount?: number;
  comicAlbumCount?: number;
}

/** 按名解析标签的结果。 */
export interface LibraryTagQueryResult {
  revision: number;
  items: LibraryTagSummary[];
  /** 库里根本没有的标签名。 */
  missing: string[];
}

export interface LibraryActivitySummary {
  revision: number;
  albumCount: number;
  unreadCount: number;
}

export interface LibraryDashboardProgress {
  album: LibraryNodeSummary;
  pageIndex: number;
  pageCount: number;
  updated: string;
}

export interface LibraryHomeDashboard {
  revision: number;
  albumCount: number;
  unreadCount: number;
  unread: LibraryNodeSummary[];
  inProgress: LibraryDashboardProgress[];
}

export interface LibraryPage<T> {
  revision: number;
  items: T[];
  total: number;
  nextCursor?: string;
}

export interface LibraryNodeQueryResult {
  revision: number;
  items: LibraryNodeSummary[];
  missing: string[];
}

export interface LibraryListQuery {
  kind: AppMode;
  parent?: string;
  tag?: string;
  view?: "all" | "album" | "collection" | "smart";
  q?: string;
  year?: string;
  minImageCount?: number;
  sort?: "name" | "count" | "added" | "recent" | "viewed";
  /**
   * 把按年份归组的代表节点从列表里去掉。
   *
   * 首页的年份索引直接给照片墙看，那些集合不必在列表里再出现一次。
   * 服务端只在顶层范围生效，集合页与标签页不受影响。
   */
  excludeYearTargets?: boolean;
}
export type LibraryListItem =
  | { kind: "album" | "collection"; node: LibraryNodeSummary }
  | { kind: "smart"; tag: LibraryTagSummary };
export interface LibraryListPage extends LibraryPage<LibraryListItem> {
  scopeCounts?: Record<"all" | "album" | "collection" | "smart", number>;
  completedCount?: number;
  latestModified?: string;
  counts: Record<"all" | "album" | "collection" | "smart", number>;
  years: {
    year: number | null;
    count: number;
    imageTotal: number;
    videoTotal: number;
    target: LibraryListItem;
    coverImage?: string;
    coverImageVersion?: string;
  }[];
  series: {
    id: string;
    name: string;
    count: number;
    coverImage?: string;
    coverImageVersion?: string;
  }[];
  imageTotal: number;
  videoTotal: number;
}

interface PageResponse<T> {
  ok: boolean;
  page: LibraryPage<T>;
}

export class LibraryRevisionChangedError extends Error {
  constructor() {
    super("library revision changed while loading pages");
  }
}

async function collectPages<T>(
  load: (cursor?: string, signal?: AbortSignal) => Promise<PageResponse<T>>,
  signal?: AbortSignal,
): Promise<LibraryPage<T>> {
  let cursor: string | undefined;
  let revision: number | undefined;
  let total = 0;
  const items: T[] = [];
  // 切换工作台模式后旧游标会失效（游标作用域含用途）：这时从第一页重来，
  // 而不是把整页加载判成失败。
  let restarted = false;
  do {
    let response: PageResponse<T>;
    try {
      response = await load(cursor, signal);
    } catch (error: unknown) {
      if (!restarted && cursor && isInvalidCursor(error)) {
        restarted = true;
        cursor = undefined;
        items.length = 0;
        revision = undefined;
        continue;
      }
      throw error;
    }
    const page = response.page;
    if (revision !== undefined && page.revision !== revision) {
      throw new LibraryRevisionChangedError();
    }
    revision = page.revision;
    total = page.total;
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return { revision: revision ?? 0, items, total };
}

// isInvalidCursor 识别「游标对不上当前作用域」这一类 400。
function isInvalidCursor(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 400 &&
    error.code === "invalid_cursor"
  );
}

async function queryNodes(
  ids: string[],
  signal?: AbortSignal,
): Promise<LibraryNodeQueryResult> {
  if (ids.length === 0) return { revision: 0, items: [], missing: [] };
  let revision: number | undefined;
  const items: LibraryNodeSummary[] = [];
  const missing: string[] = [];
  for (
    let offset = 0;
    offset < ids.length;
    offset += LIBRARY_NODE_BATCH_LIMIT
  ) {
    const response = await api<{
      ok: boolean;
      result: LibraryNodeQueryResult;
    }>("/api/library/nodes/query", {
      method: "POST",
      body: { ids: ids.slice(offset, offset + LIBRARY_NODE_BATCH_LIMIT) },
      signal,
    });
    if (revision !== undefined && response.result.revision !== revision) {
      throw new LibraryRevisionChangedError();
    }
    revision = response.result.revision;
    items.push(...response.result.items);
    missing.push(...response.result.missing);
  }
  return { revision: revision ?? 0, items, missing };
}

export const libraryApi = {
  overview: (query: LibraryListQuery, cursor?: string, signal?: AbortSignal) =>
    api<{ ok: boolean; page: LibraryListPage }>("/api/library/overview", {
      params: { ...query, cursor, limit: LIBRARY_PAGE_LIMIT },
      signal,
    }),
  manifest: (signal?: AbortSignal) =>
    api<{ ok: boolean; manifest: LibraryManifest }>("/api/library/manifest", {
      signal,
    }),
  mediaFeed: (
    query: MediaFeedQuery,
    cursor?: string,
    signal?: AbortSignal,
  ) =>
    api<{ ok: boolean; page: LibraryFeedPage }>("/api/library/media-feed", {
      params: { ...query, cursor, limit: LIBRARY_PAGE_LIMIT },
      signal,
    }),
  activitySummary: (kind: AppMode, signal?: AbortSignal) =>
    api<{ ok: boolean; summary: LibraryActivitySummary }>(
      "/api/library/activity-summary",
      { params: { kind }, signal },
    ),
  dashboard: (kind: AppMode, signal?: AbortSignal) =>
    api<{ ok: boolean; dashboard: LibraryHomeDashboard }>(
      "/api/library/dashboard",
      { params: { kind }, signal },
    ),
  unreadAlbumPage: (
    kind: AppMode,
    cursor?: string,
    limit = LIBRARY_PAGE_LIMIT,
    signal?: AbortSignal,
  ) =>
    api<PageResponse<LibraryNodeSummary>>("/api/library/unread", {
      params: { cursor, limit, kind },
      signal,
    }),
  childrenPage: (
    parentId: string,
    kind: AppMode,
    cursor?: string,
    limit = LIBRARY_PAGE_LIMIT,
    signal?: AbortSignal,
  ) =>
    api<PageResponse<LibraryNodeSummary>>(
      `/api/library/${encodeURIComponent(parentId)}/children`,
      { params: { cursor, limit, kind }, signal },
    ),
  /**
   * 一个目录下的全部子项（相册与集合），翻完所有页。
   *
   * 目录树要的是完整的子项名单：只取一页的话，树里会缺一截，
   * 目录结构看起来就不完整 —— 用户会以为这个文件夹里就这些。
   */
  childrenAll: async (
    parentId: string,
    kind: AppMode,
    signal?: AbortSignal,
  ): Promise<LibraryNodeSummary[]> => {
    const page = await collectPages<LibraryNodeSummary>(
      (cursor, sig) =>
        libraryApi.childrenPage(
          parentId,
          kind,
          cursor,
          LIBRARY_PAGE_LIMIT,
          sig,
        ),
      signal,
    );
    return page.items;
  },
  mediaPage: (
    albumId: string,
    cursor?: string,
    limit = LIBRARY_PAGE_LIMIT,
    signal?: AbortSignal,
    filter?: AlbumFilterQuery,
  ) =>
    api<{ ok: boolean; page: AlbumMediaPage }>(
      `/api/albums/${encodeURIComponent(albumId)}/media`,
      {
        params: {
          cursor,
          limit,
          from: filter?.from,
          to: filter?.to,
          personId: filter?.personId,
          adcode: filter?.adcode,
          picks: filter?.picks,
          scene: filter?.scene,
          collapse: filter?.collapse ? "1" : undefined,
          expand: filter?.expand,
        },
        signal,
      },
    ),
  /**
   * 这本相册里真实可用的筛选条件。
   *
   * 每个维度都带一个理由，说清它现在为什么不能用 —— 是还没跑分析，
   * 还是跑了但这本相册里确实没有那样的照片。
   */
  albumFilters: (albumId: string, signal?: AbortSignal) =>
    api<{ ok: boolean; revision: number; facets: AlbumFilterFacets }>(
      `/api/albums/${encodeURIComponent(albumId)}/filters`,
      { signal },
    ),
  /**
   * 往年同一天拍过照的相册。
   *
   * month/day 缺省时服务端取当天。只认拍摄日期（从文件名推断），
   * 没有拍摄时间的相册不在其中。
   */
  onThisDay: (
    kind: AppMode,
    month?: number,
    day?: number,
    limit = 20,
    signal?: AbortSignal,
    fallback = false,
  ) =>
    api<PageResponse<LibraryOnThisDayItem>>("/api/library/on-this-day", {
      params: { kind, month, day, limit, fallback: fallback ? 1 : undefined },
      signal,
    }),
  tagPage: (
    kind: AppMode,
    cursor?: string,
    limit = LIBRARY_PAGE_LIMIT,
    signal?: AbortSignal,
  ) =>
    api<PageResponse<LibraryTagSummary>>("/api/tags", {
      params: { cursor, limit, kind },
      signal,
    }),
  tagAlbumsPage: (
    tag: string,
    kind: AppMode,
    cursor?: string,
    limit = LIBRARY_PAGE_LIMIT,
    signal?: AbortSignal,
  ) =>
    api<PageResponse<LibraryNodeSummary>>(
      `/api/tags/${encodeURIComponent(tag)}/albums`,
      { params: { cursor, limit, kind }, signal },
    ),
  // scope 只区分「该模式下的任意一本」与「该模式下还没翻开的」；
  // 叫 "any" 而不是 "all"，避免和工作台模式混成一个概念。
  //
  // count 一次要几本：首页「随手看看」一次给三本候选。服务端保证
  // 抽出的相册互不相同，候选不够时给全部。
  randomAlbums: (
    kind: AppMode,
    scope: "any" | "unread" = "any",
    count = 1,
    signal?: AbortSignal,
  ) =>
    api<{
      ok: boolean;
      albums: LibraryNodeSummary[];
      revision: number;
    }>("/api/albums/random", {
      params: {
        scope: scope === "unread" ? "unread" : undefined,
        kind,
        count,
      },
      signal,
    }),
  allUnreadAlbums: (kind: AppMode, signal?: AbortSignal) =>
    collectPages(
      (cursor, sig) => libraryApi.unreadAlbumPage(kind, cursor, undefined, sig),
      signal,
    ),
  allMedia: (albumId: string, signal?: AbortSignal) =>
    collectPages(
      (cursor, sig) => libraryApi.mediaPage(albumId, cursor, undefined, sig),
      signal,
    ),
  allTags: (kind: AppMode, signal?: AbortSignal) =>
    collectPages((cursor, sig) => libraryApi.tagPage(kind, cursor, undefined, sig), signal),
  /**
   * 「最近加入」的相册摘要，按业务日期倒序。
   *
   * 照片工作台不记录浏览进度，没有「继续阅读」可言；这个列表是它与
   * 漫画侧对称的入口，也是收藏空态的推荐来源。
   */
  recentAlbums: (kind: AppMode, limit = 12, signal?: AbortSignal) =>
    api<PageResponse<LibraryNodeSummary>>("/api/library/recent", {
      params: { kind, limit },
      signal,
    }),
  /**
   * 按名批量解析标签摘要。
   *
   * 它不按工作台属性过滤，而是同时给出两侧的册数：收藏里的智能标签
   * 可能在任意一侧有作品，客户端需要同时知道两侧的册数，
   * 才能区分「这个标签失效了」和「它只属于另一侧」。
   */
  queryTags: (names: string[], signal?: AbortSignal) =>
    api<{ ok: boolean; result: LibraryTagQueryResult }>("/api/tags/query", {
      method: "POST",
      body: { names },
      signal,
    }),
  queryNodes,
};
