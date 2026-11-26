import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SelectionBar } from "./SelectionBar";
it("没有选择时隐藏，提交中禁用动作，Esc 退出", () => {
  const onExit = vi.fn(),
    props = {
      count: 0,
      noun: "张",
      actions: [{ id: "test", label: "收藏", onRun: vi.fn() }],
      onExit,
    };
  const { rerender } = render(<SelectionBar {...props} />);
  expect(screen.queryByRole("toolbar")).toBeNull();
  rerender(<SelectionBar {...props} count={2} busy />);
  expect(screen.getByRole("button", { name: "收藏" })).toBeDisabled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onExit).not.toHaveBeenCalled();
  rerender(<SelectionBar {...props} count={2} />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onExit).toHaveBeenCalledOnce();
});
