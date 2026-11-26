import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useElementSize } from "../../hooks/useElementSize";
import { markAtFraction, type TimeRailMark } from "./timeRailMarks";
import { cx } from "../../ui/cx";
export interface TimeRailProps {
  marks: TimeRailMark[];
  activeKey: string;
  onCommit: (mark: TimeRailMark) => void;
}
export function TimeRail({ marks, activeKey, onCommit }: TimeRailProps) {
  const { ref, height } = useElementSize<HTMLDivElement>(),
    [preview, setPreview] = useState<string | null>(null),
    [scrolling, setScrolling] = useState(false);
  const pointer = useRef<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const nearby = (event: globalThis.PointerEvent) => {
      if (innerWidth - event.clientX <= 80) reveal();
    };
    function reveal() {
      setScrolling(true);
      clearTimeout(timer);
      timer = setTimeout(() => setScrolling(false), 1200);
    }
    document.addEventListener("pointermove", nearby);
    document.addEventListener("scroll", reveal, true);
    return () => {
      document.removeEventListener("pointermove", nearby);
      clearTimeout(timer);
      document.removeEventListener("scroll", reveal, true);
    };
  }, []);
  const mark =
    marks.find((item) => item.key === (preview ?? activeKey)) ??
    marks.find((item) => item.key === activeKey.slice(0, 4)) ??
    marks[0];
  if (!mark) return null;
  const index = marks.indexOf(mark);
  const label =
    mark.level === "month"
      ? mark.key.slice(0, 4) + " 年 " + mark.label
      : mark.level === "year"
        ? mark.label + " 年"
        : mark.label;
  const atPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return markAtFraction(
      marks,
      Math.min(
        1,
        Math.max(0, (event.clientY - box.top) / Math.max(1, box.height)),
      ),
    );
  };
  let lastLabel = -Infinity;
  return (
    <div
      ref={ref}
      data-testid="time-rail"
      role="slider"
      aria-label="时间轨"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={marks.length - 1}
      aria-valuenow={index}
      aria-valuetext={label + " · " + mark.count + " 张"}
      tabIndex={0}
      className={cx(
        "group fixed bottom-6 right-2 top-[calc(var(--topbar-height)+16px)] z-rail hidden w-12 touch-none select-none rounded-full opacity-0 transition-opacity duration-base hover:opacity-100 focus:opacity-100 md:block",
        (scrolling || preview !== null) && "opacity-100",
      )}
      onKeyDown={(e) => {
        let i = index;
        const direction = e.key === "PageUp" || e.key === "ArrowUp" ? -1 : 1;
        switch (e.key) {
          case "Home":
            i = 0;
            break;
          case "End":
            i = marks.length - 1;
            break;
          case "ArrowUp":
          case "ArrowDown":
            i = Math.min(marks.length - 1, Math.max(0, i + direction));
            break;
          case "PageUp":
          case "PageDown": {
            const years = marks.filter((item) => item.level !== "month"),
              current = years.findIndex(
                (item) => item.key === mark.key.split("-")[0],
              );
            i = marks.indexOf(
              years[
                Math.max(0, Math.min(years.length - 1, current + direction))
              ],
            );
            break;
          }
          case "Enter":
            onCommit(mark);
            setPreview(null);
            break;
          default:
            return;
        }
        e.preventDefault();
        if (e.key !== "Enter") setPreview(marks[i].key);
      }}
      onBlur={() => setPreview(null)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        pointer.current = e.pointerId;
        setPreview(atPointer(e)?.key ?? null);
      }}
      onPointerMove={(e) => setPreview(atPointer(e)?.key ?? null)}
      onPointerLeave={() => {
        if (pointer.current === null) setPreview(null);
      }}
      onPointerUp={(e) => {
        if (pointer.current !== e.pointerId) return;
        pointer.current = null;
        const target = atPointer(e);
        if (target) onCommit(target);
        setPreview(null);
      }}
      onPointerCancel={() => {
        pointer.current = null;
        setPreview(null);
      }}
    >
      {marks
        .filter((item) => item.level !== "month")
        .map((item) => {
          const y = item.fraction * (height || 500),
            show = item.level === "unknown" || y - lastLabel >= 14;
          if (show) lastLabel = y;
          return (
            <span
              key={item.key}
              aria-hidden="true"
              style={{ top: item.fraction * 100 + "%" }}
              className="pointer-events-none absolute right-0 flex -translate-y-1/2 items-center gap-1 text-caption text-ink-3"
            >
              {show && (item.level === "unknown" ? "未知" : item.label)}
              <i className="w-1.5 border-t border-current" />
            </span>
          );
        })}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0 h-6 w-0.5 -translate-y-1/2 bg-accent"
        style={{ top: mark.fraction * 100 + "%" }}
      />
      {preview && (
        <output
          className="pointer-events-none absolute right-full mr-2 -translate-y-1/2 whitespace-nowrap rounded-full bg-inverse px-3 py-2 text-caption text-on-inverse"
          style={{ top: mark.fraction * 100 + "%" }}
        >
          {label} · {mark.count} 张
        </output>
      )}
    </div>
  );
}
export default TimeRail;
