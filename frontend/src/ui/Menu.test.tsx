import { vi, it, expect } from "vitest";
import { screen, render, fireEvent } from "@testing-library/react";
import { Menu } from "./Menu";
it("方向键循环跳过禁用项，Esc、Tab 与选择关闭菜单", () => {
  const choose = vi.fn();
  render(
    <Menu
      label="操作"
      trigger={<button>打开</button>}
      items={["一", "二", "三"].map((label, i) => ({
        label,
        id: label,
        disabled: i === 1,
        onSelect: choose,
      }))}
    />,
  );
  const trigger = screen.getByText("打开");
  fireEvent.click(trigger);
  const first = screen.getByRole("menuitem", { name: "一" }),
    last = screen.getByRole("menuitem", { name: "三" });
  expect(first).toHaveFocus();
  for (const [key, target] of [
    ["ArrowDown", last],
    ["ArrowDown", first],
    ["ArrowUp", last],
    ["Home", first],
    ["End", last],
  ] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    expect(target).toHaveFocus();
  }
  fireEvent.keyDown(last, { key: "Escape" });
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: "三" }));
  expect(choose).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).toBeNull();
});
