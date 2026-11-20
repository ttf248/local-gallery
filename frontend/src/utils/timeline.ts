import type {
  LibraryFeedItem,
  TimelineDatePrecision,
  TimelineDateSource,
} from "../api/library";

/**
 * 时间线的分组：一年的某个月，或「日期未知」的那一段。
 *
 * 分组是时间线的基本单位：照片按时间排下来，界面上要能一眼看出
 * 「这一段是什么时候拍的」。
 */
export interface TimelineGroup {
  /** 分组键：月分组是 "YYYY-M"，日期未知那一段是 "unknown"。 */
  key: string;
  /** 标题：如「2024 年 5 月」或「日期未知」。 */
  label: string;
  /** 年份；日期未知那一段是 0。 */
  year: number;
  /** 月份；日期未知那一段是 0。 */
  month: number;
  /** 这一段的时间来源说明。空串表示全是拍摄时间，不必说。 */
  note: string;
  /** 组内已加载的媒体数。 */
  count: number;
  /** 组内各时间来源的数量。 */
  sources: Partial<Record<TimelineDateSource, number>>;
  /** 组内每种日期精度的数量。 */
  precisions: Partial<Record<TimelineDatePrecision, number>>;
}

/** 「日期未知」那一段的分组键。 */
export const TIMELINE_UNKNOWN_KEY = "unknown";

/**
 * 一个媒体项属于哪一段。
 *
 * 只有拿得出拍摄证据的才进月份：修改时间不是拍摄时间，把它塞进某个月
 * 就是把拷贝来的旧照片说成那月拍的。
 */
export function timelineGroupKey(item: LibraryFeedItem): string {
  const precision = item.datePrecision;
  if (precision === "unknown" || item.dateSource === "modified") {
    return TIMELINE_UNKNOWN_KEY;
  }
  const value = item.dateValue;
  if (precision === "year" && value && /^\d{4}$/.test(value)) return value;
  if (precision === "month" && value && /^\d{4}-\d{2}$/.test(value)) {
    return value;
  }
  if (precision === "day" && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.slice(0, 7);
  }
  const captured = item.capturedAt;
  if (!captured || captured.length < 7) return TIMELINE_UNKNOWN_KEY;
  return captured.slice(0, 7);
}

function itemDatePrecision(item: LibraryFeedItem): TimelineDatePrecision {
  if (item.datePrecision) return item.datePrecision;
  if (item.dateSource === "modified" || !item.capturedAt) return "unknown";
  return "day";
}

/**
 * 按时间来源给一句话说明。
 *
 * 界面上必须照实说：文件名推断出来的日期不是拍摄时间，目录名推断出来的
 * 也不是。把两者混进「拍摄时间」里，用户会以为每一张都是那天拍的。
 */
export function timelineSourceLabel(source: TimelineDateSource): string {
  switch (source) {
    case "exif":
      return "拍摄时间";
    case "filename":
      return "文件名推断";
    case "folder":
      return "目录推断";
    case "modified":
      return "日期未知";
    default:
      return "时间来源未知";
  }
}

/** "2024-05" → 「2024 年 5 月」。 */
export function timelineGroupLabel(key: string): string {
  if (key === TIMELINE_UNKNOWN_KEY) return "日期未知";
  if (/^\d{4}$/.test(key)) return `${Number(key)} 年`;
  const [year, month] = key.split("-");
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  if (!yearNumber || !monthNumber) return key;
  return `${yearNumber} 年 ${monthNumber} 月`;
}

/**
 * 把已加载的媒体按月份分组。
 *
 * 组按第一次出现的顺序排：时间线是按时间倒序下来的，因此月份也是从新
 * 到旧。「日期未知」那一段没有月份，排在最后。
 */
export function buildTimelineGroups(
  items: readonly LibraryFeedItem[],
): TimelineGroup[] {
  const groups = new Map<string, TimelineGroup>();
  for (const item of items) {
    const key = timelineGroupKey(item);
    let group = groups.get(key);
    if (!group) {
      const [year, month] =
        key === TIMELINE_UNKNOWN_KEY ? [0, 0] : key.split("-");
      group = {
        key,
        label: timelineGroupLabel(key),
        year: Number(year) || 0,
        month: Number(month) || 0,
        note: "",
        count: 0,
        sources: {},
        precisions: {},
      };
      groups.set(key, group);
    }
    group.count += 1;
    const source = item.dateSource ?? "modified";
    group.sources[source] = (group.sources[source] ?? 0) + 1;
    const precision = itemDatePrecision(item);
    group.precisions[precision] = (group.precisions[precision] ?? 0) + 1;
  }
  for (const group of groups.values()) {
    group.note = timelineGroupNote(group);
  }
  return [...groups.values()];
}

/**
 * 一段的时间来源说明。
 *
 * 全是拍摄时间时不说话：那一段本来就没什么要交代的，多一句反而像在
 * 提醒用户有什么问题。掺了推断出来的日期就必须说清 —— 那一段的月份是
 * 猜的，不能让人以为每张都是那天拍的。
 */
export function timelineGroupNote(group: TimelineGroup): string {
  if (group.key === TIMELINE_UNKNOWN_KEY) {
    return "只有文件修改时间，不是拍摄时间";
  }
  // 这一段里只要有一张的时间是推断出来的，就要说明这段月份不能当成拍摄
  // 时间看。数量不在这里报：已加载的那几页不代表整段，各来源的准确
  // 数量由顶部的来源说明统一给出。
  const inferred = Object.keys(group.sources).some(
    (source) => source !== "exif",
  );
  const notes: string[] = [];
  if (inferred) notes.push("含推断时间");
  if (group.precisions.year) notes.push("仅精确到年份");
  else if (group.precisions.month) notes.push("含仅精确到年月的日期");
  return notes.join(" · ");
}

export function timelinePrecisionLabel(
  precision: TimelineDatePrecision,
): string {
  switch (precision) {
    case "day":
      return "精确到日";
    case "month":
      return "仅年月";
    case "year":
      return "仅年份";
    case "unknown":
      return "日期未知";
  }
}

/**
 * 时间线的年份区间，如「2011 – 2025」。
 *
 * 没有年份时给空串：界面上不摆一个空的区间。
 */
export function timelineYearRange(years: readonly { year: number }[]): string {
  if (years.length === 0) return "";
  const numbers = years.map((entry) => entry.year).filter((year) => year > 0);
  if (numbers.length === 0) return "";
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  return min === max ? `${min}` : `${min} – ${max}`;
}

/**
 * 时间线的筛选条件。
 *
 * 它同时也是地址栏里的查询参数：跳到某一年是一个可以分享、可以后退的
 * 地址，而不是一次回不去的操作。
 */
export interface TimelineFilter {
  /** 选中的年份；空串是全部；"unknown" 是「日期未知」那一段。 */
  year: string;
  /** 选中的月份；空串是全部。 */
  month: string;
  /** 选中的媒体类型；空串是全部。 */
  media: string;
}
