import {
  useMemo,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import type { TimelineYear } from "../../api/library";
import { useElementSize } from "../../hooks/useElementSize";

export interface ScrubberYearMark {
  year: string;
  label: string;
  count: number;
  ratio: number;
}

export interface TimelineScrubberProps {
  years: TimelineYear[];
  unknownCount: number;
  activeYear: string;
  onSelectYear: (year: string) => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildScrubberMarks(
  years: TimelineYear[],
  unknownCount: number,
): ScrubberYearMark[] {
  const dated = years
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.year - a.year);
  const first = dated[0]?.year ?? 0;
  const last = dated.at(-1)?.year ?? first;
  const stride = Math.max(1, (first - last) / Math.max(1, dated.length - 1));
  const span = Math.max(1, first - last + (unknownCount > 0 ? stride : 0));
  const marks = dated.map(({ year, count }) => ({
    year: String(year),
    label: String(year),
    count,
    ratio: (first - year) / span,
  }));
  if (unknownCount > 0)
    marks.push({
      year: "unknown",
      label: "未知",
      count: unknownCount,
      ratio: 1,
    });
  return marks;
}

export default function TimelineScrubber({
  years,
  unknownCount,
  activeYear,
  onSelectYear,
}: TimelineScrubberProps) {
  const { ref, height } = useElementSize<HTMLDivElement>();
  const [preview, setPreview] = useState<ScrubberYearMark>();
  const [dragging, setDragging] = useState(false);
  const marks = useMemo(
    () => buildScrubberMarks(years, unknownCount),
    [years, unknownCount],
  );
  if (marks.length < 2) return null;

  const activeIndex = Math.max(
    0,
    marks.findIndex(({ year }) => year === activeYear),
  );
  const active = marks[activeIndex];
  const maxLabels = Math.min(15, Math.max(2, Math.floor((height || 280) / 23)));
  const spacing = Math.max(23, height / Math.max(1, maxLabels - 1));
  const shown = [marks[0]];
  for (const mark of marks.slice(1, -1)) {
    const previous = shown[shown.length - 1];
    if (
      (mark.ratio - previous.ratio) * height >= spacing &&
      (1 - mark.ratio) * height >= spacing
    ) {
      shown.push(mark);
    }
  }
  shown.push(marks[marks.length - 1]);

  function locate(event: PointerEvent<HTMLDivElement>) {
    const { top, height: markHeight } =
      event.currentTarget.getBoundingClientRect();
    const ratio = markHeight
      ? Math.max(0, Math.min(1, (event.clientY - top) / markHeight))
      : 0;
    return marks.reduce((nearest, item) =>
      Math.abs(item.ratio - ratio) < Math.abs(nearest.ratio - ratio)
        ? item
        : nearest,
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let index: number;
    switch (event.key) {
      case "Home":
        index = 0;
        break;
      case "End":
        index = marks.length - 1;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        index = Math.max(0, activeIndex - 1);
        break;
      case "ArrowDown":
      case "ArrowRight":
        index = Math.min(marks.length - 1, activeIndex + 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    onSelectYear(marks[index].year);
  }

  return (
    <div className="timeline-scrubber">
      <div
        ref={ref}
        className="timeline-scrubber__track"
        role="slider"
        aria-label="时间线年份"
        aria-orientation="vertical"
        aria-valuemin={1}
        aria-valuemax={marks.length}
        aria-valuenow={activeIndex + 1}
        aria-valuetext={
          active.year === "unknown" ? "日期未知" : `${active.label} 年`
        }
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDragging(true);
          setPreview(locate(event));
        }}
        onPointerMove={(event) => setPreview(locate(event))}
        onPointerLeave={() => {
          if (!dragging) setPreview(undefined);
        }}
        onPointerCancel={() => {
          setDragging(false);
          setPreview(undefined);
        }}
        onLostPointerCapture={() => setDragging(false)}
        onPointerUp={(event) => {
          if (!dragging) return;
          setDragging(false);
          const mark = locate(event);
          setPreview(mark);
          onSelectYear(mark.year);
        }}
      >
        {shown.map((mark) => (
          <span
            key={mark.year}
            className="timeline-scrubber__mark"
            aria-hidden="true"
            style={{ top: `${mark.ratio * 100}%` }}
          >
            {mark.label}
          </span>
        ))}
        <span
          className="timeline-scrubber__current"
          aria-hidden="true"
          style={{ top: `${active.ratio * 100}%` }}
        />
        {preview && (
          <span
            className="timeline-scrubber__preview"
            aria-hidden="true"
            style={{ top: `${preview.ratio * 100}%` }}
          >
            {preview.year === "unknown" ? "日期未知" : `${preview.label} 年`} ·{" "}
            {preview.count} 张
          </span>
        )}
      </div>
    </div>
  );
}
