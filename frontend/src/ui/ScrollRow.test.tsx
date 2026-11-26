import { vi, it, expect } from "vitest";
import { screen, render, fireEvent } from "@testing-library/react";
import { ScrollRow } from "./ScrollRow";
it("在端点隐藏箭头并按行宽的 85% 键盘或按钮滚动", () => {
  render(<ScrollRow label="照片">内容</ScrollRow>);
  const row = screen.getByRole("region");
  Object.defineProperties(row, {
    clientWidth: { value: 400 },
    scrollWidth: { value: 1000 },
    scrollBy: { value: vi.fn() },
  });
  fireEvent.scroll(row);
  expect(screen.queryByRole("button", { name: "向左滚动" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "向右滚动" }));
  expect(row.scrollBy).toHaveBeenCalledWith(
    expect.objectContaining({ left: 340 }),
  );
  row.scrollLeft = 600;
  fireEvent.scroll(row);
  expect(screen.queryByRole("button", { name: "向右滚动" })).toBeNull();
  fireEvent.keyDown(row, { key: "ArrowLeft" });
  expect(row.scrollBy).toHaveBeenLastCalledWith(
    expect.objectContaining({ left: -340 }),
  );
});
