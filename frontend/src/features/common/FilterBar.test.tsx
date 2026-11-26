import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { FilterBar } from "./FilterBar";

function TestFilter() {
  const [open, setOpen] = useState(false);
  return (
    <FilterBar
      label="筛选"
      count={2}
      open={open}
      onOpenChange={setOpen}
      dialogLabel="照片条件"
      panel={<input aria-label="名称" />}
    />
  );
}

it("筛选面板在工具条外展开，Escape 将焦点交还筛选按钮", () => {
  const { container } = render(<TestFilter />);
  const trigger = screen.getByRole("button", { name: /筛选/ });
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "照片条件" });
  expect(container).not.toContainElement(dialog);
  expect(dialog).toHaveFocus();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
});

it("点击面板内的条件保持展开，点击外部关闭", () => {
  render(<TestFilter />);
  fireEvent.click(screen.getByRole("button", { name: /筛选/ }));
  fireEvent.mouseDown(screen.getByRole("textbox", { name: "名称" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
});
