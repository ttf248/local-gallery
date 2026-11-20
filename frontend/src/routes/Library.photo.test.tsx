import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Library from "./Library";
import { useAppModeStore } from "../store/appModeStore";
import { useSortPreference } from "../store/sortPreference";

/**
 * 照片侧相册页的标题。
 *
 * 顶层默认视图（全部）里摆着相册、集合与标签三类资源，标题说「全部相册」
 * 就会与内容对不上 —— 用户会以为集合没列出来。标题要跟着视图走。
 */

// 组件只发 hook，hook 自己取数 —— mock 掉避免网络。
vi.mock("../hooks/useLibraryList", () => ({
  useLibraryList: vi.fn(),
}));
vi.mock("../hooks/useLibrary", () => ({
  useLibraryManifest: vi.fn(),
  useLibraryNodes: vi.fn(),
  useLibraryAncestors: vi.fn(),
  useLibraryDashboard: vi.fn(),
}));
vi.mock("../hooks/useGalleryContextSync", () => ({
  useGalleryContextSync: vi.fn(),
}));
vi.mock("../hooks/useListFilters", () => ({
  useListFilters: vi.fn(),
}));
vi.mock("../components/common/ListFilterBar", () => ({
  ListFilterBar: () => <div data-testid="filter-bar" />,
}));
vi.mock("../components/album/AlbumGrid", () => ({
  default: ({ items }: { items: { id: string; title: string }[] }) => (
    <div data-testid="album-grid">
      {items.map((item) => (
        <span key={item.id}>{item.title}</span>
      ))}
    </div>
  ),
}));

import { useLibraryList } from "../hooks/useLibraryList";
import {
  useLibraryAncestors,
  useLibraryDashboard,
  useLibraryManifest,
  useLibraryNodes,
} from "../hooks/useLibrary";
import { useListFilters } from "../hooks/useListFilters";
import type { ViewKey } from "../utils/listFilterParams";

function seedList() {
  vi.mocked(useLibraryList).mockReturnValue({
    cards: [],
    summary: { counts: { all: 3, album: 1, collection: 1, smart: 1 } },
    query: { kind: "photo" },
    nextCursor: undefined,
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  } as never);
}

function setView(view: ViewKey) {
  vi.mocked(useListFilters).mockReturnValue({
    query: "",
    setQuery: vi.fn(),
    sortBy: "name",
    setSortBy: vi.fn(),
    minImageCount: 0,
    setMinImageCount: vi.fn(),
    view,
    setView: vi.fn(),
    yearFilter: null,
    setYearFilter: vi.fn(),
    toggleYearFilter: vi.fn(),
    reset: vi.fn(),
  } as never);
}

function renderLibrary(entry = "/photo/library") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Library />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("照片相册页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppModeStore.setState({ preference: "photo", hydrated: true });
    useSortPreference.setState({ sortBy: "name", sortTouched: false });
    vi.mocked(useLibraryManifest).mockReturnValue({
      data: {
        manifest: {
          roots: [{ id: "r1", name: "photo-lib", contentKind: "photo" }],
          statistics: {
            albumCount: 9,
            photoAlbumCount: 9,
            comicAlbumCount: 0,
          },
        },
      },
      isLoading: false,
    } as never);
    vi.mocked(useLibraryNodes).mockReturnValue({
      data: { items: [] },
      isLoading: false,
    } as never);
    vi.mocked(useLibraryAncestors).mockReturnValue({
      data: [],
      isLoading: false,
    } as never);
    vi.mocked(useLibraryDashboard).mockReturnValue({
      data: { dashboard: { inProgress: [], unread: [], unreadCount: 0 } },
      isLoading: false,
    } as never);
    setView("all");
    seedList();
  });

  it("顶层默认视图混合相册、集合与标签，标题不叫「全部相册」", async () => {
    renderLibrary();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "全部内容",
      );
    });
    expect(screen.queryByText("全部相册")).not.toBeInTheDocument();
  });

  it("视图切到相册时标题说是相册，切到集合时说是集合", async () => {
    setView("album");
    const { unmount } = renderLibrary();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "全部相册",
      );
    });
    unmount();

    setView("collection");
    renderLibrary();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "全部集合",
      );
    });
  });

  it("顶层不挂栏目眉标，进了某一层才挂", async () => {
    const { unmount } = renderLibrary();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "全部内容",
      );
    });
    expect(screen.queryByText("相册")).not.toBeInTheDocument();
    unmount();

    vi.mocked(useLibraryNodes).mockReturnValue({
      data: {
        items: [
          {
            id: "c_year",
            kind: "collection",
            name: "2025",
            displayName: "2025",
            contentKind: "photo",
          },
        ],
      },
      isLoading: false,
    } as never);
    renderLibrary("/photo/library?node=c_year");
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("2025");
    });
    // 眉标说的是「这一层在相册那一侧」；面包屑里也有一个「相册」，
    // 因此这里按眉标定位。
    expect(document.querySelector(".page-eyebrow")).toHaveTextContent("相册");
  });
});
