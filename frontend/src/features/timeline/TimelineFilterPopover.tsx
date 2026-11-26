import { useState } from "react";
import { Badge } from "../../ui/Badge";
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
import Popover, { PopoverLabel, PopoverSeparator } from "../../ui/Popover";
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
  const [open, setOpen] = useState(false);
  const active = [filter.year, filter.month, filter.media].filter(
    Boolean,
  ).length;
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
      open={open}
      onOpenChange={setOpen}
      aria-label="时间线筛选"
      className="w-[min(360px,calc(100vw-16px))] space-y-2 p-3"
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-caption hover:bg-bg-subtle"
          aria-label="筛选时间线"
        >
          <FilterIcon size={16} />
          筛选
          {active > 0 && (
            <Badge tone="signal" aria-label={active + " 个筛选条件"}>
              {active}
            </Badge>
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
              ...Array.from({ length: 12 }, (_, i) => {
                const month = i + 1,
                  count =
                    year.months?.find((m) => m.month === month)?.count ?? 0;
                return {
                  value: String(month),
                  label: month + " 月（" + count + "）",
                  disabled: count === 0,
                };
              }),
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
          <div className="timeline-filter-legend py-1.5 px-2.5 text-caption text-fg-muted">
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
      {active > 0 && (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="btn btn-ghost"
          onClick={() => onChange({ year: "", month: "", media: "" })}
        >
          清除筛选
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="rounded-lg px-3 py-2 text-caption"
        onClick={() => setOpen(false)}
      >
        完成
      </button>
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
  choices: { value: string; label: string; disabled?: boolean }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={name} className="grid grid-cols-4 gap-1">
      {choices.map(({ value, label, disabled }) => (
        <button
          key={value}
          disabled={disabled}
          role="menuitemradio"
          type="button"
          tabIndex={-1}
          aria-checked={value === selected}
          className="rounded-md px-1 py-1.5 text-caption tabular-nums hover:bg-bg-subtle aria-checked:bg-signal-soft disabled:opacity-40"
          onClick={() => onSelect(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
