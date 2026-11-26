import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { StatusDot } from "./StatusDot";
it("状态始终有文字", () => {
  render(<StatusDot status="warning" label="需留意" />);
  expect(screen.getByText("需留意")).toBeVisible();
});
