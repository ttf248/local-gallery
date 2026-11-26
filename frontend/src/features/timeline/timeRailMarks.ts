export interface TimeRailMark {
  key: string;
  label: string;
  fraction: number;
  count: number;
  level: "year" | "month" | "unknown";
}
interface Year {
  year: number;
  count: number;
  months?: ReadonlyArray<{ month: number; count: number }>;
}
export function buildTimeRailMarks(
  years: readonly Year[],
  unknownCount: number,
  {
    minYearFraction = 0.02,
    railHeight = Infinity,
  }: { minYearFraction?: number; railHeight?: number } = {},
): TimeRailMark[] {
  const dated = years
    .filter((year) => year.count > 0)
    .sort((a, b) => b.year - a.year);
  if (dated.length + (unknownCount > 0 ? 1 : 0) < 2) return [];
  const total = dated.reduce((n, y) => n + y.count, 0),
    extent = unknownCount > 0 ? 0.96 : 1,
    minimum = Math.min(extent / dated.length, Math.max(0, minYearFraction));
  const marks: TimeRailMark[] = [];
  let offset = 0;
  for (const year of dated) {
    const span =
      minimum + ((extent - dated.length * minimum) * year.count) / total;
    marks.push({
      key: String(year.year),
      label: String(year.year),
      fraction: offset,
      count: year.count,
      level: "year",
    });
    const months = (year.months ?? [])
      .filter((m) => m.count > 0)
      .sort((a, b) => b.month - a.month);
    let cumulative = 0;
    if (railHeight >= 480)
      for (const month of months) {
        marks.push({
          key: year.year + "-" + String(month.month).padStart(2, "0"),
          label: month.month + " 月",
          fraction:
            offset + (span * (cumulative + month.count / 2)) / year.count,
          count: month.count,
          level: "month",
        });
        cumulative += month.count;
      }
    offset += span;
  }
  if (unknownCount > 0)
    marks.push({
      key: "unknown",
      label: "日期未知",
      fraction: 1,
      count: unknownCount,
      level: "unknown",
    });
  return marks;
}
export function markAtFraction(
  marks: readonly TimeRailMark[],
  fraction: number,
) {
  if (!marks.length) return null;
  let lo = 0,
    hi = marks.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (marks[mid].fraction < fraction) lo = mid + 1;
    else hi = mid;
  }
  const before = marks[lo - 1];
  return before && fraction - before.fraction <= marks[lo].fraction - fraction
    ? before
    : marks[lo];
}
