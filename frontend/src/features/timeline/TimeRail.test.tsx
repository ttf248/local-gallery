import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import TimeRail from "./TimeRail";
import { buildTimeRailMarks } from "./timeRailMarks";
const marks = buildTimeRailMarks(
  [
    { year: 2024, count: 90, months: [{ month: 6, count: 70 }] },
    { year: 2023, count: 10 },
  ],
  4,
);
it("单段隐藏，多段支持按月或按年预览与明确提交", () => {
  const onCommit = vi.fn();
  const { rerender } = render(
    <TimeRail marks={[]} activeKey="" onCommit={onCommit} />,
  );
  expect(screen.queryByRole("slider")).toBeNull();
  rerender(<TimeRail marks={marks} activeKey="2024" onCommit={onCommit} />);
  const rail = screen.getByRole("slider");
  fireEvent.keyDown(rail, { key: "ArrowDown" });
  expect(rail).toHaveAttribute("aria-valuetext", "2024 年 6 月 · 70 张");
  fireEvent.keyDown(rail, { key: "PageDown" });
  expect(rail).toHaveAttribute("aria-valuetext", "2023 年 · 10 张");
  fireEvent.keyDown(rail, { key: "End" });
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.keyDown(rail, { key: "Enter" });
  expect(onCommit).toHaveBeenCalledWith(marks.at(-1));
});
it("拖动只更新气泡，松手提交一次", () => {
  if (!window.PointerEvent) vi.stubGlobal("PointerEvent", MouseEvent);
  const onCommit = vi.fn();
  render(<TimeRail marks={marks} activeKey="2024" onCommit={onCommit} />);
  const rail = screen.getByRole("slider");
  vi.spyOn(rail, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ y: 100, height: 240 }),
  );
  fireEvent.pointerDown(rail, { pointerId: 1, button: 0, clientY: 102 });
  fireEvent.pointerMove(rail, { pointerId: 1, clientY: 340 });
  expect(screen.getByText("日期未知 · 4 张")).toBeInTheDocument();
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.pointerUp(rail, { pointerId: 1, clientY: 340 });
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith(marks.at(-1));
});
