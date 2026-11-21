import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PickItem, PickPage } from "../api/picks";
import { picksApi } from "../api/picks";
import { usePhotoSelectionStore } from "../store/photoSelectionStore";
import Picks from "./Picks";

vi.mock("../api/picks", () => ({
  picksApi: { media: vi.fn() },
}));

vi.mock("../hooks/usePickToggle", () => ({
  usePickToggle: () => ({
    isPicked: () => true,
    toggle: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../components/wall/PhotoWall", () => ({
  default: ({
    items,
    loadMoreError,
    onLoadMore,
  }: {
    items: PickItem[];
    loadMoreError?: boolean;
    onLoadMore: () => void;
  }) => (
    <div
      data-testid="picks-wall"
      data-load-more-error={String(loadMoreError ?? false)}
    >
      {items.map((item) => (
        <span key={item.id} data-testid="pick-item">
          {item.name}
        </span>
      ))}
      <button type="button" onClick={onLoadMore}>
        触发续页
      </button>
    </div>
  ),
}));

vi.mock("../components/wall/PickShowcase", () => ({
  default: ({ items }: { items: PickItem[] }) => (
    <div data-testid="pick-showcase">
      {items.map((item) => (
        <span key={item.id} data-testid="pick-item">
          {item.name}
        </span>
      ))}
    </div>
  ),
}));

function item(id: string): PickItem {
  return {
    id,
    kind: "image",
    name: `${id}.jpg`,
    index: Number(id.slice(2)),
    kindIndex: Number(id.slice(2)),
    albumId: "a_1",
    albumName: "相册",
  };
}

function page(ids: string[], total: number, nextCursor?: string) {
  const response: { ok: true; page: PickPage } = {
    ok: true,
    page: {
      revision: 1,
      items: ids.map(item),
      total,
      nextCursor,
    },
  };
  return response;
}

function renderPicks() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Picks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("精选页分页错误恢复", () => {
  beforeEach(() => {
    vi.mocked(picksApi.media).mockReset();
    usePhotoSelectionStore.getState().clear();
  });

  it("首屏失败提供可点击的重试", async () => {
    vi.mocked(picksApi.media)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(page(["f_1"], 1));

    renderPicks();

    fireEvent.click(await screen.findByRole("button", { name: "重试加载" }));

    expect(await screen.findByTestId("pick-showcase")).toBeInTheDocument();
    expect(screen.getByText("f_1.jpg")).toBeInTheDocument();
    expect(picksApi.media).toHaveBeenCalledTimes(2);
  });

  it("后续分页失败保留照片、暂停自动续页并手动接续", async () => {
    vi.mocked(picksApi.media)
      .mockResolvedValueOnce(page(["f_1", "f_2"], 20, "cursor-2"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(page(["f_3", "f_4"], 20));

    renderPicks();

    const loadedItems = await screen.findAllByTestId("pick-item");
    expect(loadedItems).toHaveLength(2);
    const wall = screen.getByTestId("picks-wall");
    expect(screen.queryByTestId("pick-showcase")).not.toBeInTheDocument();
    expect(wall).toHaveAttribute("data-load-more-error", "false");

    fireEvent.click(screen.getByRole("button", { name: "触发续页" }));
    expect(
      await screen.findByText("后续精选照片加载失败，已加载的照片仍可浏览。"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("picks-wall")).toHaveAttribute(
      "data-load-more-error",
      "true",
    );
    expect(screen.getAllByTestId("pick-item")).toHaveLength(2);

    // PhotoWall 即使再次报告触底，失败状态也不再自动请求。
    fireEvent.click(screen.getByRole("button", { name: "触发续页" }));
    await waitFor(() => expect(picksApi.media).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));

    await waitFor(() =>
      expect(screen.getAllByTestId("pick-item")).toHaveLength(4),
    );
    expect(screen.getByText("f_1.jpg")).toBeInTheDocument();
    expect(screen.getByText("f_2.jpg")).toBeInTheDocument();
    expect(screen.getByText("f_3.jpg")).toBeInTheDocument();
    expect(screen.getByText("f_4.jpg")).toBeInTheDocument();
    expect(screen.queryByTestId("pick-showcase")).not.toBeInTheDocument();
    expect(picksApi.media).toHaveBeenCalledTimes(3);
    expect(picksApi.media).toHaveBeenNthCalledWith(2, "cursor-2");
    expect(picksApi.media).toHaveBeenNthCalledWith(3, "cursor-2");
  });
});
