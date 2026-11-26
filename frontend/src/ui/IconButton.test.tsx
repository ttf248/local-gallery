import { it, expect } from "vitest";
import { screen, render } from "@testing-library/react";
import { IconButton } from "./IconButton";
it("图形按钮有名称与按下状态", () => {
  render(<IconButton pressed label="显示信息" />);
  expect(screen.getByRole("button", { name: "显示信息" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
