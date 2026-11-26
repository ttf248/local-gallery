import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { ProgressRing } from "./ProgressRing";
it("数值范围和不确定进度的读屏语义正确", () => {
  const { rerender } = render(<ProgressRing value={175} label="分析进度" />);
  expect(screen.getByRole("progressbar", { name: "分析进度" })).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  rerender(<ProgressRing value={null} label="准备中" />);
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
});
