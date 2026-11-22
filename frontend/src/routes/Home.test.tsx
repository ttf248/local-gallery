import { listFixture } from "../test-library-list";
import { useLibraryList } from "../hooks/useLibraryList";
vi.mock("../hooks/useLibraryList", async (original) => ({
  ...(await original<typeof import("../hooks/useLibraryList")>()),
  useLibraryList: vi.fn(),
}));
vi.mock("../hooks/useSmartAlbums", () => ({
  useSmartAlbumDirectory: () => ({
    items: [
      {
        albumId: "a_1",
        albumName: "2023年测试相册",
        parentName: "家庭照片",
        group: {
          id: "sg_0123456789abcdef0123",
          dimension: "recommended",
          name: "2024年春游",
          suggestedName: "2024年春游",
          customName: false,
          photoCount: 3,
          coverResourceId: "f_cover",
          coverVersion: "v1",
          hidden: false,
          qualityScore: 0.82,
          evidenceDimensions: ["time", "place", "scene"],
          recommendationReasons: ["连续拍摄时间", "同一地点", "相近场景"],
        },
      },
    ],
    total: 1,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  }),
}));
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { LibraryNodeSummary } from "../api/library";
import { historyApi } from "../api/prefs";
import { useSortPreference } from "../store/sortPreference";
import { useUIStore } from "../store/uiStore";
import { useAppModeStore } from "../store/appModeStore";
import Home from "./Home";

const mocks = vi.hoisted(() => ({
  items: [] as LibraryNodeSummary[],
  inProgress: true,
  listItems: undefined as LibraryNodeSummary[] | undefined,
  recent: [] as LibraryNodeSummary[],
  onThisDay: [] as unknown[],
  manifest: undefined as unknown,
}));

vi.mock("../api/prefs", () => ({ historyApi: { list: vi.fn() } }));
vi.mock("../hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn(),
  }),
}));
vi.mock("../hooks/useScanSSE", () => ({
  useScanSSE: () => ({ isRunning: false }),
}));
vi.mock("../hooks/useGalleryContextSync", () => ({
  useGalleryContextSync: vi.fn(),
}));
vi.mock("../hooks/useImageActivity", () => ({
  useImageActivities: () => ({ data: {} }),
  useMarkAlbumRead: () => ({ mutateAsync: vi.fn() }),
  useMarkAlbumsRead: () => ({ mutateAsync: vi.fn() }),
}));
// 英雄区与时间线用占位元素代替：这里只关心「筛选条相对它们的位置」。
vi.mock("../components/home/YearTimeline", () => ({
  default: () => <div data-testid="year-timeline" />,
}));
// 智能相册墙按容器宽度排布：测试里给一个固定宽度。
vi.mock("../hooks/useElementSize", () => ({
  useElementSize: () => ({
    ref: () => {},
    width: 1200,
    height: 800,
    element: null,
  }),
}));
// 照片墙走真实接口：这里换成固定的一份，首页用例不依赖网络。
vi.mock("../hooks/useMediaFeed", () => ({
  useMediaFeed: () => ({
    items: [
      {
        id: "f_1",
        kind: "image",
        name: "1.jpg",
        index: 0,
        kindIndex: 0,
        albumId: "a_1",
        albumName: "第一本",
      },
    ],
    albums: [],
    sources: [],
    years: [],
    unknown: 0,
    dateSources: {},
    // 时间线工具条要按日期精度说话；这份固定数据里没有精度分布，
    // 与真实 hook 的缺省一致（拿不到就是空分布，不是不存在）。
    datePrecisions: {},
    total: 1,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
}));
vi.mock("../components/home/HomeHeroes", () => ({
  ContinueHero: () => <div data-testid="continue-hero" />,
  UnreadHero: () => <div data-testid="unread-hero" />,
}));
vi.mock("../components/album/AlbumGrid", () => ({
  default: ({
    items,
  }: {
    items: { id: string; title: string; to: string }[];
  }) => (
    <ol data-testid="album-grid">
      {items.map((item) => (
        <li key={item.id} data-to={item.to}>
          {item.title}
        </li>
      ))}
    </ol>
  ),
}));
vi.mock("../hooks/useLibrary", () => {
  const query = (items: LibraryNodeSummary[]) => ({
    data: { items, missing: [], total: items.length },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  return {
    useLibraryOverview: () => ({
      manifest: mocks.manifest,
      nodes: mocks.items,
      tags: [],
      isLoading: false,
      isError: false,
    }),
    useLibraryDashboard: () => ({
      data: {
        dashboard: {
          unread: [mocks.items[0]],
          unreadCount: 1,
          inProgress: mocks.inProgress
            ? mocks.items.map((album) => ({
                album,
                pageIndex: 1,
                pageCount: 3,
              }))
            : [],
        },
      },
      isLoading: false,
    }),
    useLibraryManifest: () => ({
      data: { manifest: mocks.manifest },
      isLoading: false,
    }),
    useLibraryUnreadAlbums: () => query(mocks.items),
    useLibraryChildren: () => query(mocks.items),
    // 照片侧的「最近加入」专区。
    useLibraryRecentAlbums: () => ({
      data: {
        page: {
          revision: 1,
          items: mocks.recent,
          total: mocks.recent.length,
        },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useOnThisDayAlbums: () => ({
      data: {
        page: {
          revision: 1,
          items: mocks.onThisDay,
          total: mocks.onThisDay.length,
        },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useTagAlbums: () => query(mocks.items),
    useLibraryTags: () => ({ data: { items: [] }, isLoading: false }),
    useLibraryNodes: () => query(mocks.items),
    useAlbumMedia: () => ({ data: undefined, isLoading: false }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ viewMode: "grid" });
  useSortPreference.setState({ sortBy: "name", sortTouched: false });
  mocks.inProgress = true;
  mocks.listItems = undefined;
  mocks.recent = [];
  mocks.onThisDay = [];
  mocks.manifest = {
    revision: 1,
    scannedAt: "2026-10-31T00:00:00Z",
    roots: [{ id: "r_fixture", name: "素材", childCount: 1 }],
    statistics: {
      rootCount: 1,
      albumCount: 2,
      photoAlbumCount: 1,
      comicAlbumCount: 1,
      collectionCount: 0,
      tagCount: 0,
      warningCount: 0,
    },
  };
  vi.mocked(useLibraryList).mockImplementation(
    (query) =>
      listFixture(
        { data: { items: mocks.listItems ?? mocks.items } },
        query,
      ) as never,
  );
  // 「继续阅读」与「未读」属于漫画工作台，首页的这些用例都在漫画模式跑。
  useAppModeStore.setState({ preference: "comic", hydrated: true });
  vi.mocked(historyApi.list).mockResolvedValue({ history: [] });
  mocks.items = [
    {
      id: "a_1",
      kind: "album",
      contentKind: "photo",
      name: "2023年测试相册",
      displayName: "2023年测试相册",
      imageCount: 3,
      coverImages: [],
      modTime: "2024-01-01T00:00:00Z",
      date: "2024-01-01T00:00:00Z",
    },
    {
      id: "a_2",
      kind: "album",
      contentKind: "photo",
      name: "2024年测试相册",
      displayName: "2024年测试相册",
      imageCount: 4,
      coverImages: [],
      modTime: "2024-02-01T00:00:00Z",
      date: "2024-02-01T00:00:00Z",
    },
  ];
});

function renderHome(entry = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

// 漫画首页有通往书架的入口。
it("漫画首页有通往书架的明确入口", async () => {
  renderHome();
  await waitFor(() => expect(screen.getByTestId("unread-hero")).toBeTruthy());
  const link = screen.getByRole("link", { name: /书架/ });
  expect(link).toHaveAttribute("href", "/comic/library");
});

// 照片工作台没有阅读进度，也没有未读：两个区块都不出现。
it("照片工作台不显示继续阅读与未读区", async () => {
  useAppModeStore.setState({ preference: "photo", hydrated: true });
  renderHome();
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "全部照片" })).toBeTruthy(),
  );
  expect(screen.queryByTestId("continue-hero")).toBeNull();
  expect(screen.queryByTestId("unread-hero")).toBeNull();
});

// 漫画侧：阅读进度与未读是两块独立区块，不互相嵌套。
it("只有一本在读时阅读区和未读区独立呈现", async () => {
  renderHome();
  await waitFor(() => expect(screen.getByTestId("unread-hero")).toBeTruthy());
  expect(
    screen
      .getByTestId("continue-hero")
      .contains(screen.getByTestId("unread-hero")),
  ).toBe(false);
  expect(screen.getAllByTestId("unread-hero")).toHaveLength(1);
});

it("没有在读相册时未读区独立成块", async () => {
  mocks.inProgress = false;
  renderHome();
  await waitFor(() => expect(screen.getByTestId("unread-hero")).toBeTruthy());
  expect(screen.queryByTestId("continue-hero")).toBeNull();
});

// 漫画工作台不显示照片侧的「接着看」专区。
it("漫画工作台不显示「接着看」专区", async () => {
  vi.mocked(historyApi.list).mockResolvedValue({
    history: [
      {
        albumId: "a_1",
        name: "2023年测试相册",
        imageCount: 3,
        openedAt: "2024-05-01T00:00:00Z",
      },
    ],
  });
  renderHome();
  await waitFor(() => expect(screen.getByTestId("unread-hero")).toBeTruthy());
  expect(screen.queryByTestId("resume-hero")).toBeNull();
});

// 漫画首页不再列全部作品：作品与卷的清单在书架里。
it("漫画首页不再有「库内一览」网格", async () => {
  renderHome();
  await waitFor(() => expect(screen.getByTestId("unread-hero")).toBeTruthy());
  expect(screen.queryByText("库内一览")).toBeNull();
  expect(screen.queryByTestId("album-grid")).toBeNull();
});

// 漫画首页的「最近阅读」：翻过的卷能一步回到阅读器。
it("漫画首页摆出「最近阅读」专区", async () => {
  mocks.items = [
    {
      id: "a_c1",
      kind: "album",
      contentKind: "comic",
      name: "第01话 星海之生肖传说",
      displayName: "第01话 星海之生肖传说",
      parentName: "星海镖师",
      imageCount: 8,
      coverImages: [],
      modTime: "2024-01-01T00:00:00Z",
      date: "2024-01-01T00:00:00Z",
    },
  ];
  vi.mocked(historyApi.list).mockResolvedValue({
    history: [
      {
        albumId: "a_c1",
        name: "第01话 星海之生肖传说",
        imageCount: 8,
        openedAt: "2024-05-01T00:00:00Z",
      },
    ],
  });
  renderHome();
  await waitFor(() => expect(screen.getByText("最近阅读")).toBeTruthy());
  const grid = screen.getByTestId("album-grid");
  expect(grid.querySelector("li")?.getAttribute("data-to")).toBe(
    "/comic/albums/a_c1",
  );
});

