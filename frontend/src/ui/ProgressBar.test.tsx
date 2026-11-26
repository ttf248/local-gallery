import { it, expect } from "vitest";
import { screen, render } from "@testing-library/react";
import { ProgressBar } from "./ProgressBar";
it("钳制进度并为未知进度省略数值", () => {
  const view = (value?: number) => <ProgressBar label="进度" value={value} />;
  const { rerender } = render(view(-1));
  const bar = screen.getByRole("progressbar");
  expect(bar).toHaveAttribute("aria-valuenow", "0");
  rerender(view(2));
  expect(bar).toHaveAttribute("aria-valuenow", "100");
  for (const v of [NaN, undefined]) {
    rerender(view(v));
    expect(bar).not.toHaveAttribute("aria-valuenow");
  }
});
