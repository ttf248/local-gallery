import type {
  TimelineDatePrecision,
  TimelineDateSource,
  TimelineYear,
} from "../../api/library";
import {
  timelinePrecisionLabel,
  timelineSourceLabel,
  type TimelineFilter,
} from "../../utils/timeline";
import TimelineFilters from "./TimelineFilters";

interface Props {
  /** 年份索引：跳年与跳月的依据。 */
  years: TimelineYear[];
  /** 当前筛选。 */
  filter: TimelineFilter;
  /** 这一段筛选结果里的时间来源分布。 */
  dateSources: Partial<Record<TimelineDateSource, number>>;
  /** 当前筛选结果里的日期精度分布。 */
  datePrecisions: Partial<Record<TimelineDatePrecision, number>>;
  /** 「日期未知」的媒体数。 */
  unknown: number;
  /** 改筛选。 */
  onChange: (next: TimelineFilter) => void;
}

/**
 * 时间线顶部的定位、筛选与时间来源说明。
 *
 * 下面那一行说明这一段时间是怎么来的。文件名推断出来的日期不是拍摄
 * 时间，目录名推断出来的也不是 —— 界面上照实说，用户才知道哪些照片的
 * 时间可信。
 */
export default function TimelineToolbar({
  years,
  filter,
  dateSources,
  datePrecisions,
  unknown,
  onChange,
}: Props) {
  const parts = (Object.entries(dateSources) as [TimelineDateSource, number][])
    .filter(([, count]) => count > 0)
    .map(([source, count]) => `${timelineSourceLabel(source)} ${count} 张`);
  // 只有一种来源时不说话：那一段本来没什么要交代的。
  const legend = parts.length <= 1 ? "" : parts.join(" · ");
  const precisionParts = (
    Object.entries(datePrecisions) as [TimelineDatePrecision, number][]
  )
    .filter(([, count]) => count > 0)
    .map(
      ([precision, count]) =>
        `${timelinePrecisionLabel(precision)} ${count} 张`,
    );
  const showPrecision =
    (datePrecisions.month ?? 0) > 0 || (datePrecisions.year ?? 0) > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <TimelineFilters
        years={years}
        filter={filter}
        unknown={unknown}
        onChange={onChange}
      />
      {legend ? (
        <p
          className="text-meta text-fg-subtle"
          data-testid="timeline-source-legend"
        >
          时间来源：{legend}
        </p>
      ) : null}
      {showPrecision ? (
        <p
          className="text-meta text-fg-subtle"
          data-testid="timeline-precision-legend"
        >
          日期精度：{precisionParts.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
