import { vi, it, expect } from "vitest";
import { screen, render, fireEvent } from "@testing-library/react";
import { Switch } from "./Switch";
it("以原生按钮支持空格激活并报告状态", () => {
  const change = vi.fn();
  render(<Switch label="启用" checked={false} onChange={change} />);
  const button = screen.getByRole("switch", { name: "启用" });
  expect(button.tagName).toBe("BUTTON");
  expect(button).toHaveAttribute("aria-checked", "false");
  fireEvent.click(button);
  expect(change).toHaveBeenCalledWith(true);
});
