import type {
  AlbumFilterFacets,
  AlbumFilterQuery,
} from "../api/library";

/**
 * 原始照片墙的筛选条件：地址栏、接口参数与界面状态共用一份。
 *
 * 认不出的值一律降级为默认，不报错 —— 地址栏是用户能直接改的地方，
 * 改错了不该让整页空白。
 */
export type AlbumFilterState = AlbumFilterQuery;

/** 地址栏里的参数名。与接口参数同名，读写都省一层转换。 */
export const ALBUM_FILTER_PARAM = {
  from: "from",
  to: "to",
  person: "personId",
  place: "adcode",
  picks: "picks",
  scene: "scene",
  collapse: "collapse",
  expand: "expand",
} as const;

/** 读取地址栏里的筛选条件。 */
export function parseAlbumFilter(
  params: URLSearchParams,
): AlbumFilterState {
  const state: AlbumFilterState = {};
  const from = params.get(ALBUM_FILTER_PARAM.from)?.trim() ?? "";
  const to = params.get(ALBUM_FILTER_PARAM.to)?.trim() ?? "";
  if (isAlbumMonth(from)) state.from = from;
  if (isAlbumMonth(to)) state.to = to;
  if (state.from && state.to && state.from > state.to) {
    // 起止写反了：按用户读得懂的方向理解，而不是整条作废。
    const swapped = state.from;
    state.from = state.to;
    state.to = swapped;
  }
  const person = params.get(ALBUM_FILTER_PARAM.person)?.trim() ?? "";
  if (person) state.personId = person;
  const place = params.get(ALBUM_FILTER_PARAM.place)?.trim() ?? "";
  if (place && /^\d+$/.test(place)) state.adcode = Number(place);
  const picks = params.get(ALBUM_FILTER_PARAM.picks)?.trim() ?? "";
  if (picks === "only" || picks === "none") state.picks = picks;
  const scene = params.get(ALBUM_FILTER_PARAM.scene)?.trim() ?? "";
  if (scene === "groupPhoto" || scene === "similar") state.scene = scene;
  const collapse = params.get(ALBUM_FILTER_PARAM.collapse)?.trim() ?? "";
  if (collapse === "1" || collapse === "true") state.collapse = true;
  const expand = params.get(ALBUM_FILTER_PARAM.expand)?.trim() ?? "";
  if (expand) state.expand = expand;
  return state;
}

/** 把筛选条件写进地址栏参数：只写生效的，其余一律不出现。 */
export function albumFilterParams(state: AlbumFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.from) params.set(ALBUM_FILTER_PARAM.from, state.from);
  if (state.to) params.set(ALBUM_FILTER_PARAM.to, state.to);
  if (state.personId) params.set(ALBUM_FILTER_PARAM.person, state.personId);
  if (state.adcode) params.set(ALBUM_FILTER_PARAM.place, String(state.adcode));
  if (state.picks) params.set(ALBUM_FILTER_PARAM.picks, state.picks);
  if (state.scene) params.set(ALBUM_FILTER_PARAM.scene, state.scene);
  if (state.collapse) params.set(ALBUM_FILTER_PARAM.collapse, "1");
  if (state.expand) params.set(ALBUM_FILTER_PARAM.expand, state.expand);
  return params;
}

/** 生效的条件条数：折叠是显示方式，不算一条筛选。 */
export function albumFilterCount(state: AlbumFilterState): number {
  let count = 0;
  if (state.from || state.to) count += 1;
  if (state.personId) count += 1;
  if (state.adcode) count += 1;
  if (state.picks) count += 1;
  if (state.scene) count += 1;
  return count;
}

/** 判断是不是空条件。 */
export function isAlbumFilterEmpty(state: AlbumFilterState): boolean {
  return albumFilterCount(state) === 0;
}

/** 判断是不是 "YYYY-MM"。 */
export function isAlbumMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

/** 把月份说成人读的样子。 */
export function albumMonthLabel(month: string): string {
  if (!isAlbumMonth(month)) return month;
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}

/** 把年份说成人读的样子。 */
export function albumYearLabel(year: string): string {
  return `${year}年`;
}

/** 选中某一年：整年都在范围内。 */
export function albumYearRange(year: string): AlbumFilterState {
  return { from: `${year}-01`, to: `${year}-12` };
}

/** 选中某个月：范围就是那一个月。 */
export function albumMonthRange(month: string): AlbumFilterState {
  return { from: month, to: month };
}

/** 判断某个月份是否落在当前时间范围内。 */
export function albumMonthInRange(
  state: AlbumFilterState,
  month: string,
): boolean {
  if (!state.from && !state.to) return true;
  if (state.from && month < state.from) return false;
  if (state.to && month > state.to) return false;
  return true;
}

/** 判断某一年是否落在当前时间范围内。 */
export function albumYearInRange(
  state: AlbumFilterState,
  year: string,
): boolean {
  if (!state.from && !state.to) return true;
  const start = state.from ? `${state.from.slice(0, 4)}-12` : "0000-00";
  const end = state.to ? `${state.to.slice(0, 4)}-01` : "9999-99";
  return `${year}-12` >= start && `${year}-01` <= end;
}

/** 一条生效条件的说法：给界面上的条件标签用。 */
export interface AlbumFilterChip {
  key: string;
  label: string;
  /** 去掉这条条件之后剩下的条件。 */
  clear: AlbumFilterState;
}

/**
 * 把生效的条件列成一句话一条的标签。
 *
 * 条件能组合：选中的时间、人物、地点各自成一条，
 * 逐条可以去掉，不必回到面板里再点一次。
 */
export function albumFilterChips(
  state: AlbumFilterState,
  facets?: AlbumFilterFacets,
): AlbumFilterChip[] {
  const chips: AlbumFilterChip[] = [];
  if (state.from || state.to) {
    const label = albumTimeChipLabel(state.from, state.to);
    chips.push({
      key: "time",
      label,
      clear: { ...state, from: undefined, to: undefined },
    });
  }
  if (state.personId) {
    const person = facets?.people.items.find(
      (item) => item.id === state.personId,
    );
    chips.push({
      key: "person",
      label: person ? `人物：${person.name}` : "人物",
      clear: { ...state, personId: undefined },
    });
  }
  if (state.adcode) {
    const place = facets?.places.items.find(
      (item) => item.adcode === state.adcode,
    );
    chips.push({
      key: "place",
      label: place ? `地点：${place.name}` : "地点",
      clear: { ...state, adcode: undefined },
    });
  }
  if (state.picks) {
    chips.push({
      key: "picks",
      label: state.picks === "only" ? "已精选" : "未精选",
      clear: { ...state, picks: undefined },
    });
  }
  if (state.scene) {
    chips.push({
      key: "scene",
      label: state.scene === "groupPhoto" ? "只看合照" : "只看相似照片",
      clear: { ...state, scene: undefined },
    });
  }
  return chips;
}

/** 时间范围的说法：整年、整月与跨月各说各的。 */
export function albumTimeChipLabel(from?: string, to?: string): string {
  if (from && to && from === to) return `拍摄时间：${albumMonthLabel(from)}`;
  // 整年就说整年：「2024年1月 至 2024年12月」是一句没人会说的话。
  if (from && to && from.endsWith("-01") && to.endsWith("-12")) {
    return `拍摄时间：${from.slice(0, 4)}年`;
  }
  if (from && to) {
    return `拍摄时间：${albumMonthLabel(from)} 至 ${albumMonthLabel(to)}`;
  }
  if (from) return `拍摄时间：${albumMonthLabel(from)} 起`;
  if (to) return `拍摄时间：至 ${albumMonthLabel(to)}`;
  return "拍摄时间";
}

/** 画面口径的说法。 */
export function albumSceneLabel(scene: string): string {
  return scene === "groupPhoto" ? "只看合照" : "只看相似照片";
}
