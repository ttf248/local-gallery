import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TimelineScrubber, { buildScrubberMarks } from "./TimelineScrubber";
import type { TimelineYear } from "../../api/library";

const years: TimelineYear[] = [
  { year: 2010, count: 5, months: [] },
  { year: 2023, count: 7, months: [] },
  { year: 2026, count: 9, months: [] },
];

describe("时间线年份标尺", () => {
  beforeEach(() => {
    if (window.PointerEvent === undefined) {
      vi.stubGlobal("PointerEvent", MouseEvent);
    }
  });

  it("按年份跨度映射稀疏数据，未知日期单列在末尾", () => {
    const marks = buildScrubberMarks(years, 4);
    expect(marks.map(({ year }) => year)).toEqual([
      "2026",
      "2023",
      "2010",
      "unknown",
    ]);
    expect(marks[1].ratio).toBeCloseTo(0.125);
    expect(marks.at(-1)).toMatchObject({ ratio: 1, count: 4 });
  });

  it("没有第二个时间段时隐藏，键盘可跳到未知日期", () => {
    const onSelectYear = vi.fn();
    const { rerender } = render(
      <TimelineScrubber
        years={years.slice(0, 1)}
        unknownCount={0}
        activeYear=""
        onSelectYear={onSelectYear}
      />,
    );
    expect(screen.queryByRole("slider")).toBeNull();
    rerender(
      <TimelineScrubber
        years={years.slice(0, 1)}
        unknownCount={2}
        activeYear=""
        onSelectYear={onSelectYear}
      />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    expect(onSelectYear).toHaveBeenCalledTimes(1);
    expect(onSelectYear).toHaveBeenCalledWith("unknown");
  });

  it("拖拽经过稀疏年份只预览，松手后提交一次", () => {
    const onSelectYear = vi.fn();
    render(
      <TimelineScrubber
        years={years}
        unknownCount={4}
        activeYear="2026"
        onSelectYear={onSelectYear}
      />,
    );
    const track = screen.getByRole("slider");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ y: 100, height: 240 }),
    );
    fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientY: 102 });
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 130 });
    expect(screen.getByText("2023 年 · 7 张")).toBeInTheDocument();
    expect(onSelectYear).not.toHaveBeenCalled();
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(track, { pointerId: 1, clientY: 340 });
    expect(onSelectYear).toHaveBeenCalledTimes(1);
    expect(onSelectYear).toHaveBeenCalledWith("unknown");
  });
});
