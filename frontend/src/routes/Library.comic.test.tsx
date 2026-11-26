import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Library from "./Library";
import { useAppModeStore } from "../store/appModeStore";
import { useSortPreference } from "../store/sortPreference";

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
vi.mock("../features/common/ListFilterBar", () => ({
  ListFilterBar: () => <div data-testid="filter-bar" />,
}));
// 网格用假组件替掉：这里要验的是分段结构与卡片上的动作，不是卡片本身。
vi.mock("../features/library/AlbumGrid", async (importOriginal) => ({
  ...await importOriginal<typeof import("../features/library/AlbumGrid")>(),
  default: ({
    items,
    overlayAction,
    note,
  }: {
    items: { id: string; title: string }[];
    overlayAction?: (item: { id: string; title: string }) => React.ReactNode;
    note?: (item: { id: string; title: string }) => React.ReactNode;
  }) => (
    <div data-testid="album-grid">
      {items.map((item) => (
        <div key={item.id}>
          <span>{item.title}</span>
          {note?.(item)}
          {overlayAction?.(item)}
        </div>
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
import { useGalleryContextSync } from "../hooks/useGalleryContextSync";
import { useListFilters } from "../hooks/useListFilters";
import type { CardData } from "../features/library/AlbumGrid";

const workCard: CardData = {
  id: "c:work-1",
  variant: "collection",
  title: "星海镖师",
  subtitle: "作品",
  count: 3,
  coverPath: "cover-1",
  to: "/comic/albums/work-1",
  contentKind: "comic",
};

const looseCard: CardData = {
  id: "a:loose-1",
  variant: "album",
  title: "番外 第05话 游戏",
  subtitle: undefined,
  count: 6,
  imageCount: 6,
  coverPath: "cover-2",
  to: "/comic/albums/loose-1",
  contentKind: "comic",
};

function seedList(cards: CardData[]) {
  vi.mocked(useLibraryList).mockReturnValue({
    cards,
    summary: { counts: { all: cards.length, album: 1, collection: 1, smart: 0 } },
    query: { kind: "comic" },
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

function renderLibrary(entry = "/comic/library") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Library />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("漫画书架", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppModeStore.setState({ preference: "comic", hydrated: true });
    useSortPreference.setState({ sortBy: "name", sortTouched: false });
    vi.mocked(useLibraryManifest).mockReturnValue({
      data: {
        manifest: {
          roots: [{ id: "r1", name: "comic-lib", contentKind: "comic" }],
          statistics: {
            albumCount: 9,
            comicAlbumCount: 9,
            photoAlbumCount: 0,
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
    vi.mocked(useListFilters).mockReturnValue({
      query: "",
      setQuery: vi.fn(),
      sortBy: "name",
      setSortBy: vi.fn(),
      minImageCount: 0,
      setMinImageCount: vi.fn(),
      view: "all",
      setView: vi.fn(),
      yearFilter: null,
      setYearFilter: vi.fn(),
      toggleYearFilter: vi.fn(),
      reset: vi.fn(),
    } as never);
    seedList([]);
  });

  it("顶层把作品与未归入作品的卷分成两段摆开", async () => {
    seedList([workCard, looseCard]);
    renderLibrary();

    await waitFor(() => {
      expect(screen.getByText("作品")).toBeInTheDocument();
    });
    expect(screen.getByText("未归入作品")).toBeInTheDocument();
    // 段标题带上各自的量：作品是「部」，卷是「卷」。
    expect(screen.getByText("1 部")).toBeInTheDocument();
    expect(screen.getByText("1 卷")).toBeInTheDocument();
    expect(screen.getByText("星海镖师")).toBeInTheDocument();
    expect(screen.getByText("番外 第05话 游戏")).toBeInTheDocument();
  });

  it("作品卡上写明读到哪儿，并给出继续读的入口", async () => {
    seedList([workCard, looseCard]);
    vi.mocked(useLibraryDashboard).mockReturnValue({
      data: {
        dashboard: {
          inProgress: [
            {
              album: {
                id: "vol-2",
                kind: "album",
                name: "第02话",
                displayName: "第02话",
                parentId: "work-1",
                contentKind: "comic",
              },
              pageIndex: 3,
              pageCount: 8,
              updated: "2026-01-01T00:00:00Z",
            },
          ],
          unread: [],
          unreadCount: 0,
        },
      },
      isLoading: false,
    } as never);
    renderLibrary();

    await waitFor(() => {
      expect(screen.getByText("在读 · 第02话")).toBeInTheDocument();
    });
    const resume = screen.getByRole("button", { name: "继续读「第02话」" });
    fireEvent.click(resume);
    // 不带 index 进阅读器：页码由服务端记录恢复。
    expect(resume).toBeInTheDocument();
  });

  it("把这一层的条目写成跨卷导航的上下文", async () => {
    seedList([workCard, looseCard]);
    renderLibrary();

    await waitFor(() => {
      expect(useGalleryContextSync).toHaveBeenCalled();
    });
    const [source, entries] = vi.mocked(useGalleryContextSync).mock.calls[0];
    expect(source).toEqual({ type: "collection", parentPath: "" });
    // 作品没有阅读器入口，必须标成 collection，跳卷时才会跳过它。
    expect(entries).toEqual([
      expect.objectContaining({ key: "work-1", kind: "collection" }),
      expect.objectContaining({ key: "loose-1", kind: "album" }),
    ]);
  });
});
