import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { groupMemoriesByYear } from "./memories";
import { MemoriesHero } from "./MemoriesHero";
const years = groupMemoriesByYear(
  ["甲", "乙"].map((name, index) => ({
    name,
    id: name,
    kind: "image",
    albumId: "a1",
    albumName: "家",
    index,
    kindIndex: index,
    dateValue: "2024-11-27",
  })),
  new Date(2026, 10, 27),
);
it("按年打开，单年补图可以从指定照片开始", () => {
  const open = vi.fn(),
    dismiss = vi.fn();
  const { rerender } = render(
    <MemoriesHero
      years={[]}
      onOpen={open}
      onDismiss={dismiss}
      collapsed={false}
    />,
  );
  expect(screen.queryByRole("region")).toBeNull();
  rerender(
    <MemoriesHero
      years={years}
      onOpen={open}
      onDismiss={dismiss}
      collapsed={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /2 年前/ }));
  expect(open).toHaveBeenLastCalledWith(years[0], 0);
  fireEvent.click(screen.getByRole("button", { name: "乙" }));
  expect(open).toHaveBeenLastCalledWith(years[0], 1);
  fireEvent.click(screen.getByRole("button", { name: "回忆选项" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "今天不再显示" }));
  expect(dismiss).toHaveBeenCalledOnce();
});
it("低矮视口从年份摘要打开底部面板", () => {
  render(
    <MemoriesHero
      years={years}
      onOpen={() => {}}
      onDismiss={() => {}}
      collapsed
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /那年今日 · 1 个年份/ }));
  expect(screen.getByRole("dialog", { name: "那年今日" })).toBeVisible();
});
