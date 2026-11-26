import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { FloatingBar } from "./FloatingBar";
it("关闭状态不占位，打开后按 Esc 退出", () => {
  const props = {
    label: "整理选择",
    summary: "已选 2 项",
    actions: <button>收藏</button>,
    onClose: vi.fn(),
  };
  const { rerender } = render(<FloatingBar {...props} open={false} />);
  expect(screen.queryByRole("region")).toBeNull();
  rerender(<FloatingBar {...props} open />);
  expect(screen.getByRole("region", { name: "整理选择" })).toBeVisible();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(props.onClose).toHaveBeenCalledOnce();
});
