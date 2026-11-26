import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryFeedItem } from "../../api/library";
import type { ContentSearchSubmission } from "../../hooks/useContentSearchQuery";
import ContentSearchResults from "./ContentSearchResults";

const searchQuery = vi.hoisted(() => ({
  result: null as unknown,
  refetch: vi.fn(),
  fetchNextPage: vi.fn(),
}));

vi.mock("../../hooks/useContentSearchQuery", () => ({
  useContentSearchQuery: () => searchQuery.result,
}));

vi.mock("../../hooks/usePickToggle", () => ({
  usePickToggle: () => ({ isPicked: () => false, toggle: vi.fn() }),
}));

vi.mock("../wall/PhotoWall", () => ({
  default: ({
    items,
    loadMoreError,
    onLoadMore,
  }: {
    items: LibraryFeedItem[];
    loadMoreError?: boolean;
    onLoadMore: () => void;
  }) => (
    <div
      data-testid="content-wall"
      data-load-more-error={String(loadMoreError ?? false)}
    >
      {items.map((item) => (
        <span key={item.id} data-testid="loaded-item">
          {item.name}
        </span>
      ))}
      <button type="button" onClick={onLoadMore}>
        自动续页探针
      </button>
    </div>
  ),
}));

function item(id: string): LibraryFeedItem {
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

const submitted: ContentSearchSubmission = {
  request: { kind: "photo", text: "海边" },
  token: 1,
};

function renderResults() {
  return render(<ContentSearchResults submitted={submitted} />);
}

describe("ContentSearchResults 分页错误恢复", () => {
  beforeEach(() => {
    searchQuery.refetch.mockReset();
    searchQuery.fetchNextPage.mockReset();
    searchQuery.result = {
      data: undefined,
      error: new Error("server error"),
      isError: false,
      isLoading: true,
      isFetching: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      hasNextPage: false,
      refetch: searchQuery.refetch,
      fetchNextPage: searchQuery.fetchNextPage,
    };
  });

  it("首屏失败显示可点击的重新搜索", () => {
    searchQuery.result = {
      ...(searchQuery.result as object),
      isError: true,
      isLoading: false,
    };

    renderResults();
    fireEvent.click(screen.getByRole("button", { name: "重新搜索" }));

    expect(searchQuery.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("content-wall")).not.toBeInTheDocument();
  });

  it("后续分页失败保留已加载结果，手动重试后接续且不重复", () => {
    const first = [item("f_1"), item("f_2")];
    const second = [item("f_3"), item("f_4")];
    searchQuery.result = {
      data: {
        pages: [
          {
            results: first.map((entry) => ({ item: entry, similarity: 0.9 })),
            total: 4,
            nextOffset: 2,
          },
        ],
      },
      error: new TypeError("Failed to fetch"),
      isError: true,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      isFetchNextPageError: true,
      hasNextPage: true,
      refetch: searchQuery.refetch,
      fetchNextPage: searchQuery.fetchNextPage,
    };

    const { rerender } = renderResults();

    expect(screen.getByTestId("content-wall")).toHaveAttribute(
      "data-load-more-error",
      "true",
    );
    expect(
      screen.getByText("后续搜索结果加载失败，已加载的照片仍可浏览。"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("loaded-item")).toHaveLength(2);
    expect(screen.getByText("f_1.jpg")).toBeInTheDocument();
    expect(screen.getByText("f_2.jpg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "自动续页探针" }));
    expect(searchQuery.fetchNextPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(searchQuery.fetchNextPage).toHaveBeenCalledTimes(1);

    searchQuery.result = {
      ...(searchQuery.result as object),
      data: {
        pages: [
          {
            results: first.map((entry) => ({ item: entry, similarity: 0.9 })),
            total: 4,
            nextOffset: 2,
          },
          {
            results: second.map((entry) => ({ item: entry, similarity: 0.8 })),
            total: 4,
            nextOffset: 4,
          },
        ],
      },
      isError: false,
      isFetchNextPageError: false,
    };
    rerender(<ContentSearchResults submitted={submitted} />);

    expect(screen.getAllByTestId("loaded-item")).toHaveLength(4);
    expect(screen.getByText("f_1.jpg")).toBeInTheDocument();
    expect(screen.getByText("f_2.jpg")).toBeInTheDocument();
    expect(screen.getByText("f_3.jpg")).toBeInTheDocument();
    expect(screen.getByText("f_4.jpg")).toBeInTheDocument();
    expect(screen.getByTestId("content-wall")).toHaveAttribute(
      "data-load-more-error",
      "false",
    );
  });
});
