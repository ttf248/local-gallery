import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { SmartAlbumDimension } from "../api/albums";
import {
  ALBUM_FILTER_PARAM,
  albumFilterCount,
  albumFilterParams,
  parseAlbumFilter,
  type AlbumFilterState,
} from "../utils/albumFilter";

/**
 * 相册页地址栏里的分组参数。
 *
 * 分组不是另一本相册，是同一本相册的另一种看法 —— 所以它和筛选条件
 * 住在一起：换一种看法就是一个能分享、能后退的地址。
 */
export const ALBUM_GROUP_PARAM = {
  /** 分组维度：time / place / people / scene / recommended。 */
  dimension: "dimension",
  /** 选中的分组 id。 */
  group: "group",
} as const;

const DIMENSIONS: readonly SmartAlbumDimension[] = [
  "recommended",
  "time",
  "place",
  "people",
  "scene",
];

/** 认得出的分组维度；认不出的当作没有分组。 */
export function parseAlbumDimension(
  raw: string | null,
): SmartAlbumDimension | null {
  if (!raw) return null;
  return DIMENSIONS.includes(raw as SmartAlbumDimension)
    ? (raw as SmartAlbumDimension)
    : null;
}

/**
 * 原始照片墙的查看状态：分组视图里一条都不成立。
 *
 * 分组是服务端算好的一段照片，它自己就是筛过的结果。筛选条件与相似
 * 折叠留在地址栏里，分组视图却一条都不认 —— 那是「地址栏说着一套
 * 条件、墙上摆着另一套照片」的静默忽略。进入分组时把它们清掉。
 */
function clearRawWallParams(params: URLSearchParams) {
  for (const key of Object.values(ALBUM_FILTER_PARAM)) {
    params.delete(key);
  }
}

export interface AlbumViewState {
  /** 生效的筛选条件（拍摄时间、人物、地点、精选、相似组）。 */
  filter: AlbumFilterState;
  /** 换筛选条件。 */
  setFilter: (next: AlbumFilterState) => void;
  /** 去掉全部筛选条件，保留折叠方式。 */
  clearFilter: () => void;
  /** 生效的条件条数。 */
  filterCount: number;
  /** 分组维度；null 表示不分组（默认就是原始照片墙）。 */
  dimension: SmartAlbumDimension | null;
  /** 换分组维度：换维度时清掉选中的分组。 */
  setDimension: (dimension: SmartAlbumDimension | null) => void;
  /** 选中的分组 id；null 表示看这一本的全部照片。 */
  groupId: string | null;
  /**
   * 选中某个分组，或回到全部照片。
   *
   * 选分组是一次「走进去」：地址进历史，后退键能退回全部照片。
   *
   * replace 是给系统自动纠错用的（分组被删、被重建、ID 失效）：那不是
   * 用户的操作，往历史里追加地址只会让后退一次多一条死链。
   */
  setGroupId: (
    groupId: string | null,
    options?: { replace?: boolean },
  ) => void;
}

/**
 * 相册页的视图状态：筛选条件与分组都住在地址栏里。
 *
 * 原始照片墙是默认状态：打开相册看到的就是这本相册里的照片。分组是
 * 一种可选的看法，选了它地址栏里才有 dimension / group —— 换个看法是
 * 一次能后退的操作，不是把用户推到另一本相册去。
 *
 * 两套条件不叠加：普通筛选条件只作用于原始照片墙；进入某个具体分组
 * 时它们被明确结束（地址栏里也一并去掉），分组本身就是筛好的结果。
 */
export function useAlbumViewState(): AlbumViewState {
  const [params, setParams] = useSearchParams();
  const filter = useMemo(() => parseAlbumFilter(params), [params]);
  const dimension = parseAlbumDimension(params.get(ALBUM_GROUP_PARAM.dimension));
  const groupId = params.get(ALBUM_GROUP_PARAM.group)?.trim() || null;

  const setFilter = useCallback(
    (next: AlbumFilterState) => {
      const nextParams = new URLSearchParams(params);
      for (const key of Object.values(ALBUM_FILTER_PARAM)) {
        nextParams.delete(key);
      }
      albumFilterParams(next).forEach((value, key) =>
        nextParams.set(key, value),
      );
      if (nextParams.toString() !== params.toString()) {
        setParams(nextParams);
      }
    },
    [params, setParams],
  );

  const clearFilter = useCallback(
    () => setFilter({ collapse: filter.collapse }),
    [filter.collapse, setFilter],
  );

  const setDimension = useCallback(
    (next: SmartAlbumDimension | null) => {
      const nextParams = new URLSearchParams(params);
      if (next) {
        nextParams.set(ALBUM_GROUP_PARAM.dimension, next);
        // 换维度时先回到「这一维度的全部照片」：上一个维度的分组 id 在
        // 新维度里不存在，留着会指向一个空分组。
        nextParams.delete(ALBUM_GROUP_PARAM.group);
      } else {
        nextParams.delete(ALBUM_GROUP_PARAM.dimension);
        nextParams.delete(ALBUM_GROUP_PARAM.group);
      }
      if (nextParams.toString() !== params.toString()) {
        setParams(nextParams, { replace: true });
      }
    },
    [params, setParams],
  );

  const setGroupId = useCallback(
    (id: string | null, options?: { replace?: boolean }) => {
      const nextParams = new URLSearchParams(params);
      if (id && dimension) {
        nextParams.set(ALBUM_GROUP_PARAM.group, id);
        nextParams.set(ALBUM_GROUP_PARAM.dimension, dimension);
        /* 分组视图不认原始照片墙的任何条件：清掉，别让地址栏继续
           挂着一套在分组里根本不生效的筛选。 */
        clearRawWallParams(nextParams);
      } else {
        /* 没有分组，或分组没有维度作伴：那个参数指向一个不存在的
           看法，删掉。 */
        nextParams.delete(ALBUM_GROUP_PARAM.group);
      }
      if (nextParams.toString() !== params.toString()) {
        // 选分组是一次「走进去」：地址进历史，后退键能退回全部照片。
        // 系统自动纠错改用 replace：不往历史里追加失效的地址。
        setParams(nextParams, { replace: options?.replace ?? false });
      }
    },
    [dimension, params, setParams],
  );

  return {
    filter,
    setFilter,
    clearFilter,
    filterCount: albumFilterCount(filter),
    dimension,
    setDimension,
    groupId,
    setGroupId,
  };
}
