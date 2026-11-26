import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import MemoriesStrip from "./MemoriesStrip";
import { useUIStore } from "../../store/uiStore";
import type { LibraryFeedItem } from "../../api/library";
const photos: LibraryFeedItem[] = [];
vi.mock("../../hooks/useLibrary", () => ({
  usePhotoMemories: () => ({ data: { items: photos } }),
}));
afterEach(() => {
  photos.length = 0;
  vi.useRealTimers();
  useUIStore.setState({ memoriesDismissedOn: null });
});
it("关闭后记住本机日期，次日重新出现", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 31, 23, 59));
  const strip = () => (
    <MemoryRouter>
      <MemoriesStrip resume={{ title: "旅行", to: "/photo/albums/a_1" }} />
    </MemoryRouter>
  );
  render(strip());
  fireEvent.click(screen.getByRole("button", { name: "今天隐藏回忆" }));
  expect(useUIStore.getState().memoriesDismissedOn).toBe("2026-10-31");
  expect(screen.queryByRole("region")).toBeNull();
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByRole("link", { name: /接着看/ })).toBeVisible();
});
it("没有回忆和最近相册时不占位", () => {
  render(
    <MemoryRouter>
      <MemoriesStrip />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("region")).toBeNull();
});

it("同日照片共用年份标签，邻近日子显示完整日期，折叠后可展开", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 26, 12));
  const photo = {
    id: "f_one",
    kind: "image" as const,
    name: "旅行.jpg",
    index: 0,
    kindIndex: 0,
    albumId: "a_trip",
    albumName: "旅行",
    dateValue: "2020-11-26",
    width: 4000,
    height: 3000,
  };
  photos.push(
    photo,
    { ...photo, id: "f_two", name: "合照.jpg" },
    { ...photo, id: "f_three", dateValue: "2020-11-25" },
  );
  render(
    <MemoryRouter>
      <MemoriesStrip />
    </MemoryRouter>,
  );
  const row = screen.getByRole("region", { name: "回忆照片" });
  const group = within(row).getByRole("group", { name: "2020 年的今天" });
  expect(within(group).getAllByRole("button")).toHaveLength(2);
  expect(within(row).getByText("2020 年")).toHaveAttribute(
    "datetime",
    "2020-11-26",
  );
  expect(within(row).getByText("2020.11.25")).toHaveAttribute(
    "datetime",
    "2020-11-25",
  );
  expect(row.querySelectorAll("time")).toHaveLength(2);
  expect(
    screen.getByRole("button", { name: /2020 年 11 月 25 日/ }),
  ).toBeVisible();
  expect(row.querySelector("img")).toHaveAttribute("sizes", "213px");
  const toggle = screen.getByRole("button", { name: /那年今日.*3 张/ });
  fireEvent.click(toggle);
  expect(row).not.toBeVisible();
  fireEvent.click(toggle);
  expect(row).toBeVisible();
});
