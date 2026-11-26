import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect } from "vitest";
import { Disclosure } from "./Disclosure";
it("按钮说明当前展开状态", () => {
  render(<Disclosure summary="高级信息">模型版本</Disclosure>);
  const button = screen.getByRole("button", { name: "高级信息" });
  expect(button).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("模型版本")).toBeVisible();
});
