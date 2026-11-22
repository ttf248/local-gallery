import type { TimelineYear } from "../../api/library";
import type { TimelineFilter } from "../../utils/timeline";
import Segmented from "../common/Segmented";

interface Props {
  /** 年份索引：跳年与跳月的依据。 */
  years: TimelineYear[];
  /** 当前筛选。 */
  filter: TimelineFilter;
  /** 「日期未知」的媒体数。 */
  unknown: number;
  /** 改筛选。 */
  onChange: (next: TimelineFilter) => void;
}

const SELECT_CLASS =
  "h-[34px] rounded-md border border-border bg-bg px-2 text-body text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/**
 * 时间线的定位与筛选：跳年、跳月、只看照片或视频。
 *
 * 筛选条件放在地址栏里：跳到 2024 年是一个可以分享、可以后退的地址，
 * 而不是一次回不去的操作。
 */
export default function TimelineFilters({
  years,
  filter,
  unknown,
  onChange,
}: Props) {
  const year = years.find((entry) => String(entry.year) === filter.year);
  const months = year?.months ?? [];
  const hasFilter = Boolean(filter.year || filter.month || filter.media);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <label className="inline-flex items-center gap-1.5 text-meta text-fg-muted">
        <span>年份</span>
        <select
          value={filter.year}
          onChange={(event) =>
            onChange({ ...filter, year: event.target.value, month: "" })
          }
          className={SELECT_CLASS}
        >
          <option value="">全部年份</option>
          {years.map((entry) => (
            <option key={entry.year} value={String(entry.year)}>
              {entry.year} 年（{entry.count}）
            </option>
          ))}
          {unknown > 0 ? (
            <option value="unknown">日期未知（{unknown}）</option>
          ) : null}
        </select>
      </label>

      {year ? (
        <label className="inline-flex items-center gap-1.5 text-meta text-fg-muted">
          <span>月份</span>
          <select
            value={filter.month}
            onChange={(event) =>
              onChange({ ...filter, month: event.target.value })
            }
            className={SELECT_CLASS}
          >
            <option value="">全部月份</option>
            {months.map((entry) => (
              <option key={entry.month} value={String(entry.month)}>
                {entry.month} 月（{entry.count}）
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {/* 媒体类型这一组要露标签：左边是「年份」下拉，右边这组也有一个
          「全部」，光看按钮读不出它管的是类型。标签露出来，两组各管
          一件事才读得出来（全站的分段控件都用同一个组件与同一种样子）。 */}
      <Segmented
        label="类型"
        showLabel
        value={filter.media}
        onChange={(media) => onChange({ ...filter, media })}
        options={[
          { value: "", label: "全部" },
          { value: "photo", label: "照片" },
          { value: "video", label: "视频" },
        ]}
      />

      {hasFilter ? (
        <button
          type="button"
          onClick={() => onChange({ year: "", month: "", media: "" })}
          className="chip"
        >
          清除筛选
        </button>
      ) : null}
    </div>
  );
}
