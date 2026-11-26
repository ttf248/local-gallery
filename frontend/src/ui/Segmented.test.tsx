import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { Segmented } from "./Segmented";
it("可见标签命名分段组，方向键跳过禁用项", () => {
  const change = vi.fn();
  render(
    <Segmented
      label="密度"
      showLabel
      value="a"
      options={[
        { label: "密集", value: "a" },
        { label: "默认", value: "b", disabled: true },
        { label: "宽松", value: "c" },
      ]}
      onChange={change}
    />,
  );
  expect(screen.getByRole("radiogroup", { name: "密度" })).toHaveAttribute(
    "aria-labelledby",
  );
  const first = screen.getByRole("radio", { name: "密集" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(change).toHaveBeenCalledWith("c");
  expect(screen.getByRole("radio", { name: "宽松" })).toHaveFocus();
});
