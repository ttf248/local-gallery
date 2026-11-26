import { vi, it, expect } from "vitest";
import { screen, act, render, fireEvent } from "@testing-library/react";
import { Tooltip } from "./Tooltip";
it("悬停延迟显示，键盘聚焦立即显示，Esc 关闭", () => {
  vi.useFakeTimers();
  try {
    render(
      <Tooltip content="说明">
        <button>按钮</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button");
    fireEvent.pointerEnter(button);
    act(() => vi.advanceTimersByTime(399));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(button).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("tooltip").id,
    );
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => button.focus());
    expect(screen.getByRole("tooltip")).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});
