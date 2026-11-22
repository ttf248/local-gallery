import { useState } from "react";
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
import { ChevronRightIcon } from "../common/Icon";
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
 * 时间线顶部的定位与筛选。
 *
 * 时间来源的分布收在可展开的说明里，默认收起。
 *
 * 这一段说明的是「这段时间是怎么来的」—— 文件名推断出来的日期不是
 * 拍摄时间，目录名推断出来的也不是。它必须留着（用户要判断哪些照片
 * 的时间可信），但它是解释，不是这一屏的主内容：一直摆在筛选行下面
 * 就把用户的注意力从照片上拽走了。要问的时候展开一次就够。
 */
export default function TimelineToolbar({
  years,
  filter,
  dateSources,
  datePrecisions,
  unknown,
  onChange,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
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
  const hasDetails = Boolean(legend) || showPrecision;

  return (
    <div className="flex flex-col gap-1.5">
      <TimelineFilters
        years={years}
        filter={filter}
        unknown={unknown}
        onChange={onChange}
      />
      {hasDetails ? (
        <div>
          <button
            type="button"
            onClick={() => setDetailsOpen((value) => !value)}
            aria-expanded={detailsOpen}
            className="btn-text inline-flex items-center gap-1.5 text-meta text-fg-muted hover:text-fg"
          >
            <ChevronRightIcon
              size={12}
              className={`transition-transform ${detailsOpen ? "rotate-90" : ""}`}
            />
            时间来源与日期精度
          </button>
          {detailsOpen ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-bg-elevated px-4 py-3 text-meta text-fg-muted">
              {legend ? (
                <span data-testid="timeline-source-legend">
                  时间来源：{legend}
                </span>
              ) : null}
              {showPrecision ? (
                <span data-testid="timeline-precision-legend">
                  日期精度：{precisionParts.join(" · ")}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
