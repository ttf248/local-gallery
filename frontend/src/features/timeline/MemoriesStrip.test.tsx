import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import MemoriesStrip from "./MemoriesStrip";
import { useUIStore } from "../../store/uiStore";
vi.mock("../../hooks/useLibrary", () => ({
  useOnThisDayAlbums: () => ({ data: { page: { items: [] } } }),
}));
afterEach(() => {
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
