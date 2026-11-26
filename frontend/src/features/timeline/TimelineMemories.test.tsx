import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TimelineMemories from "./MemoriesHero";
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
it("隐藏按本机日期生效，次日恢复", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 31, 23, 59));
  photos.push({
    id: "f_sample",
    kind: "image",
    name: "冬至",
    albumId: "a_1",
    albumName: "冬天",
    index: 0,
    kindIndex: 0,
    dateValue: "2024-10-31",
  });
  render(<TimelineMemories />);
  fireEvent.click(screen.getByRole("button", { name: "回忆选项" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "今天不再显示" }));
  expect(useUIStore.getState().memoriesDismissedOn).toBe("2026-10-31");
  expect(screen.queryByRole("region", { name: "回忆" })).toBeNull();
  act(() => vi.advanceTimersByTime(60000));
  expect(screen.getByRole("region", { name: "回忆" })).toBeVisible();
});
