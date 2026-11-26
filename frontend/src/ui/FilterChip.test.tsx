import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { FilterChip } from "./FilterChip";
it("使用按钮或退格键移除筛选", () => {
  const remove = vi.fn();
  render(<FilterChip label="2024 年" onRemove={remove} />);
  const button = screen.getByRole("button", { name: "移除筛选：2024 年" });
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "Backspace" });
  expect(remove).toHaveBeenCalledTimes(2);
});
