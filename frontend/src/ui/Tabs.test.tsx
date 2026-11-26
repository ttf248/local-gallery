import { vi, it, expect } from "vitest";
import { screen, render, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs";
import { MemoryRouter } from "react-router-dom";
const items = [
  { id: "a", label: "第一页" },
  { id: "b", label: "第二页" },
  { id: "c", label: "第三页" },
];
it("路由页签声明当前页", () => {
  render(
    <MemoryRouter>
      <Tabs
        label="分页"
        as="nav"
        variant="underline"
        items={items.map((item) => ({
          ...item,
          count: 3,
          href: "/" + item.id,
        }))}
        value="b"
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "第二页" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
it.each(["vertical", "horizontal"] as const)(
  "%s 页签支持方向与首尾定位",
  (orientation) => {
    const change = vi.fn();
    render(
      <Tabs
        label="分页"
        items={items}
        value="a"
        onChange={change}
        orientation={orientation}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    fireEvent.click(tabs[2]);
    expect(change).toHaveBeenLastCalledWith("c");
    const next = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
    for (const [i, key, j] of [
      [0, next, 1],
      [1, "End", 2],
      [2, "Home", 0],
    ] as const) {
      fireEvent.keyDown(tabs[i], { key });
      expect(change).toHaveBeenLastCalledWith(items[j].id);
      expect(tabs[j]).toHaveFocus();
    }
  },
);
