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
import { FilterIcon } from "../../ui/icons";
import Popover, { PopoverLabel, PopoverSeparator } from "../common/Popover";
import Segmented from "../../ui/Segmented";

const MEDIA_OPTIONS = [
  { value: "", label: "全部" },
  { value: "photo", label: "照片" },
  { value: "video", label: "视频" },
];

export function TimelineMediaControl({
  filter,
  onChange,
}: Pick<Props, "filter" | "onChange">) {
  return (
    <Segmented
      label="类型"
      options={MEDIA_OPTIONS}
      value={filter.media}
      onChange={(media) => onChange({ ...filter, media })}
    />
  );
}

interface Props {
  years: TimelineYear[];
  filter: TimelineFilter;
  dateSources: Partial<Record<TimelineDateSource, number>>;
  datePrecisions: Partial<Record<TimelineDatePrecision, number>>;
  unknown: number;
  onChange: (next: TimelineFilter) => void;
}

export default function TimelineFilterPopover({
  years,
  filter,
  dateSources,
  datePrecisions,
  unknown,
  onChange,
}: Props) {
  const year = years.find((entry) => String(entry.year) === filter.year);
  const active = Boolean(filter.year || filter.month || filter.media);
  const sources = (
    Object.entries(dateSources) as [TimelineDateSource, number][]
  )
    .filter(([, count]) => count > 0)
    .map(([source, count]) => `${timelineSourceLabel(source)} ${count} 张`);
  const precisions = (
    Object.entries(datePrecisions) as [TimelineDatePrecision, number][]
  )
    .filter(([, count]) => count > 0)
    .map(
      ([precision, count]) =>
        `${timelinePrecisionLabel(precision)} ${count} 张`,
    );
  const yearChoices = [
    { value: "", label: "全部年份" },
    ...years.map((entry) => ({
      value: String(entry.year),
      label: `${entry.year} 年（${entry.count}）`,
    })),
    ...(unknown > 0
      ? [{ value: "unknown", label: `日期未知（${unknown}）` }]
      : []),
  ];

  return (
    <Popover
      aria-label="时间线筛选"
      className="timeline-filter-popover"
      trigger={
        <button
          type="button"
          className="ui-btn ui-btn--ghost timeline-filter-trigger"
          aria-label="筛选时间线"
        >
          <FilterIcon size={16} />
          筛选
          {active && (
            <span className="timeline-filter-dot" aria-label="有筛选条件" />
          )}
        </button>
      }
    >
      <PopoverLabel>年份</PopoverLabel>
      <FilterChoices
        name="年份"
        choices={yearChoices}
        selected={filter.year}
        onSelect={(value) => onChange({ ...filter, year: value, month: "" })}
      />
      {year && (
        <>
          <PopoverLabel>月份</PopoverLabel>
          <FilterChoices
            name="月份"
            selected={filter.month}
            choices={[
              { value: "", label: "全部月份" },
              ...(year.months ?? []).map((entry) => ({
                value: String(entry.month),
                label: `${entry.month} 月（${entry.count}）`,
              })),
            ]}
            onSelect={(month) => onChange({ ...filter, month })}
          />
        </>
      )}
      <PopoverLabel>类型</PopoverLabel>
      <FilterChoices
        name="类型"
        choices={MEDIA_OPTIONS}
        selected={filter.media}
        onSelect={(media) => onChange({ ...filter, media })}
      />
      {(sources.length > 0 || precisions.length > 0) && (
        <>
          <PopoverSeparator />
          <div className="timeline-filter-legend">
            {sources.length > 0 && (
              <p data-testid="timeline-source-legend">
                时间来源 · {sources.join(" · ")}
              </p>
            )}
            {precisions.length > 0 && (
              <p data-testid="timeline-precision-legend">
                日期精度 · {precisions.join(" · ")}
              </p>
            )}
          </div>
        </>
      )}
      {active && (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="ui-btn ui-btn--ghost"
          onClick={() => onChange({ year: "", month: "", media: "" })}
        >
          清除筛选
        </button>
      )}
    </Popover>
  );
}

function FilterChoices({
  name,
  choices,
  selected,
  onSelect,
}: {
  name: string;
  choices: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={name} className="timeline-filter-choices">
      {choices.map(({ value, label }) => (
        <button
          key={value}
          role="menuitemradio"
          type="button"
          tabIndex={-1}
          aria-checked={value === selected}
          className="ui-chip"
          onClick={() => onSelect(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
