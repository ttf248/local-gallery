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
// 智能相册墙按容器宽度排布：测试里给一个固定宽度。
vi.mock("../hooks/useElementSize", () => ({
  useElementSize: () => ({
    ref: () => {},
    width: 1200,
    height: 800,
    element: null,
  }),
}));
// 英雄区与时间线用占位元素代替：这里只关心「筛选条相对它们的位置」。
vi.mock("../components/home/YearTimeline", () => ({
  default: () => <div data-testid="year-timeline" />,
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
  // rightSlot 是真实组件的右栏（只有一本在读时，首页把「未读」塞进去），
  // 占位组件也要渲染它，否则 DOM 顺序断言会漏掉未读区的位置。
  ContinueHero: ({ rightSlot }: { rightSlot?: React.ReactNode }) => (
    <div data-testid="continue-hero">{rightSlot}</div>
  ),
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
  const manifest = {
    revision: 1,
    scannedAt: "2026-10-31T00:00:00Z",
    roots: [{ id: "r_fixture", name: "素材", childCount: 1 }],
    statistics: {
      rootCount: 1,
      albumCount: 1,
      photoAlbumCount: 1,
      comicAlbumCount: 1,
      collectionCount: 0,
      tagCount: 0,
      warningCount: 0,
    },
  };
  const query = (items: LibraryNodeSummary[]) => ({
    data: { items, missing: [], total: items.length },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  return {
    useLibraryOverview: () => ({
      manifest,
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
    useLibraryManifest: () => ({ data: { manifest }, isLoading: false }),
    useLibraryUnreadAlbums: () => query(mocks.items),
    useLibraryChildren: () => query(mocks.items),
    // 照片侧的「最近加入」专区：漫画工作台不用它，这里给空列表。
    useLibraryRecentAlbums: () => ({
      data: { page: { revision: 1, items: [], total: 0 } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useOnThisDayAlbums: () => ({
      data: { page: { revision: 1, items: [], total: 0 } },
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
      // 第二个年份：时间线只在有两个真实年份桶时才出现（一条装饰性的
      // 索引筛不出东西），位置断言需要它真的渲染出来。
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

it("筛选条紧贴在「库内一览」网格上方，不被英雄区 / 时间线隔开", async () => {
  // 照片侧的「库内一览」已换成智能相册，没有网格也没有筛选条；
  // 这条版式约束留给漫画侧 —— 它仍旧列全部作品。
  useAppModeStore.setState({ preference: "comic", hydrated: true });
  renderHome();

  await waitFor(() => expect(screen.getByTestId("album-grid")).toBeTruthy());

  const heading = screen.getByText("库内一览");
  // 漫画侧的视图 chip 用漫画自己的类型词：相册 / 作品。
  const chip = screen.getByRole("button", { name: /相册/ });
  const grid = screen.getByTestId("album-grid");

  // 1) 筛选条排在「全部图像」标题之后、网格之前。
  expect(
    heading.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    chip.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  // 2) 筛选条和网格同属「全部图像」这个 section —— 控件必须贴着它控制的内容。
  const section = heading.closest("section");
  expect(section).toBeTruthy();
  expect(section?.contains(chip)).toBe(true);
  expect(section?.contains(grid)).toBe(true);

  // 3) 控件不再排在未读 / 继续阅读 / 时间线之前（它们离网格有两千多像素）。
  for (const id of ["unread-hero", "continue-hero", "year-timeline"]) {
    const hero = screen.getByTestId(id);
    expect(
      hero.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
});

// 照片侧的首屏：第一眼是照片，不是关于照片的说明。
it("照片工作台首屏先摆照片墙，再摆「接着看」", async () => {
  useAppModeStore.setState({ preference: "photo", hydrated: true });
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
  await waitFor(() => expect(screen.getByTestId("resume-hero")).toBeTruthy());
  const wall = screen.getByTestId("photo-feed-hero");
  const resume = screen.getByTestId("resume-hero");
  expect(
    wall.compareDocumentPosition(resume) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("只有一本在读时阅读区和发现区独立呈现", async () => {
  renderHome();
  await waitFor(() => expect(screen.getByTestId("album-grid")).toBeTruthy());
  // 阅读进度与发现推荐是独立区块，避免重复陈列。
  expect(
    screen
      .getByTestId("continue-hero")
      .contains(screen.getByTestId("unread-hero")),
  ).toBe(false);
});

it("多本在读时保留独立发现区且未读预览不重复", async () => {
  mocks.items = [
    ...mocks.items,
    {
      id: "a_2",
      kind: "album" as const,
      contentKind: "photo" as const,
      name: "2024年第二本",
      displayName: "2024年第二本",
      imageCount: 3,
      coverImages: [],
      modTime: "2024-01-02T00:00:00Z",
      date: "2024-01-02T00:00:00Z",
    },
  ];
  renderHome();
  await waitFor(() => expect(screen.getByTestId("album-grid")).toBeTruthy());
  // 不同在读数量都不改变发现区的归属。
  expect(
    screen
      .getByTestId("continue-hero")
      .contains(screen.getByTestId("unread-hero")),
  ).toBe(false);
  // 未读预览始终只出现一次。
  expect(screen.getAllByTestId("unread-hero")).toHaveLength(1);
});

it("没有在读相册时未读区独立成块（没有舞台可挂）", async () => {
  mocks.inProgress = false;
  renderHome();
  await waitFor(() => expect(screen.getByTestId("album-grid")).toBeTruthy());
  // 没有在读就没有「继续阅读」舞台，未读回到独立区块，
  // 否则首页第一屏只剩一个推荐货架，没有"接着读"的主入口。
  expect(screen.queryByTestId("continue-hero")).toBeNull();
  expect(screen.getByTestId("unread-hero")).toBeTruthy();
});

// 照片工作台没有阅读进度，也没有未读：两个区块都不出现。
it("照片工作台不显示继续阅读与未读区", async () => {
  useAppModeStore.setState({ preference: "photo", hydrated: true });
  renderHome();
  await waitFor(() => expect(screen.getByText("智能相册")).toBeTruthy());
  expect(screen.queryByTestId("continue-hero")).toBeNull();
  expect(screen.queryByTestId("unread-hero")).toBeNull();
  // 照片侧那一块是智能相册，不再是「库内一览」的相册网格。
  expect(screen.queryByTestId("album-grid")).toBeNull();
});

// 照片侧的对称物：漫画有「继续阅读」，照片有「接着看」。
it("照片工作台显示「接着看」专区", async () => {
  useAppModeStore.setState({ preference: "photo", hydrated: true });
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
  await waitFor(() => expect(screen.getByTestId("resume-hero")).toBeTruthy());
  expect(screen.getByTestId("resume-hero").textContent).toContain(
    "2023年测试相册",
  );
});

it("首页智能相册汇总已生成的分组并直达来源相册中的分组", async () => {
  useAppModeStore.setState({ preference: "photo", hydrated: true });
  renderHome();

  // 照片侧不再列全部图像：首页那一块就是智能相册，不必先点开哪个视图。
  expect(screen.getByText("智能相册")).toBeTruthy();
  expect(screen.queryByText("库内一览")).toBeNull();

  const smartGroupLink = await screen.findByRole("link", {
    name: /打开智能相册 2024年春游/,
  });
  expect(useLibraryList).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: "photo", view: "all" }),
    true,
  );
  expect(smartGroupLink).toHaveAttribute(
    "href",
    "/photo/albums/a_1?view=smart&dimension=recommended&group=sg_0123456789abcdef0123",
  );
  expect(smartGroupLink).toHaveTextContent("3 张 · 家庭照片 / 2023年测试相册");
  expect(smartGroupLink).toHaveTextContent(
    "连续拍摄时间 · 同一地点 · 其余 1 类",
  );
  // 首页只给一屏预览：标题与「查看全部」都通向智能相册专页。
  expect(
    screen.getByRole("heading", { name: "智能相册" }).querySelector("a"),
  ).toHaveAttribute("href", "/photo/smart-albums");
  expect(screen.getByRole("link", { name: /查看全部/ })).toHaveAttribute(
    "href",
    "/photo/smart-albums",
  );
  expect(screen.queryByTestId("album-grid")).not.toBeInTheDocument();
  expect(screen.queryByTestId("filter-bar-count")).not.toBeInTheDocument();
});

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
  await waitFor(() => expect(screen.getByTestId("album-grid")).toBeTruthy());
  expect(screen.queryByTestId("resume-hero")).toBeNull();
});

// 空结果时要说清是哪个筛选筛没了内容，并给每个生效的筛选一个手柄。
// 早先只有一个笼统的「清除筛选」，按一下还会把排序与视图一起重置。
it("空结果时按生效的筛选分别给手柄", async () => {
  mocks.listItems = [];
  renderHome("/?view=album&year=1999");
  await waitFor(() =>
    expect(screen.getByText(/没有匹配的图像/)).toBeInTheDocument(),
  );
  expect(
    screen.getByRole("button", { name: "清除年份筛选" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "看全部" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "清除筛选" }),
  ).not.toBeInTheDocument();
  // 说明里点明是哪个视图筛没了内容。
  expect(screen.getByText(/当前视图是「相册」/)).toBeInTheDocument();
});

// 视图 chip 上的数字要跟着筛选走：年份筛选生效时，chip 还报着筛选前的
// 总数，屏幕上剩下的那两件与「相册 14」对不上号。
it("视图 chip 的计数跟着年份筛选走", async () => {
  mocks.items = [
    {
      id: "a_1",
      kind: "album",
      contentKind: "photo",
      name: "2023年相册",
      displayName: "2023年相册",
      imageCount: 3,
      coverImages: [],
    },
    {
      id: "a_2",
      kind: "album",
      contentKind: "photo",
      name: "2024年相册",
      displayName: "2024年相册",
      imageCount: 5,
      coverImages: [],
    },
  ];
  renderHome("/?year=2023");
  await waitFor(() => expect(screen.getByTestId("album-grid")).toBeTruthy());
  const allChip = () => screen.getByRole("button", { name: /^全部/ });
  const albumChip = () => screen.getByRole("button", { name: /^相册/ });
  expect(allChip().textContent).toContain("2");
  expect(albumChip().textContent).toContain("2");
  // 年份筛选进了地址，也就进了列表查询。
  expect(useLibraryList).toHaveBeenLastCalledWith(
    expect.objectContaining({ year: "2023" }),
    true,
  );
});

// chip 上的数字取自当前这份列表，不是另算的全库总数。
it("视图 chip 的计数跟着列表走，不停在旧数字上", async () => {
  mocks.items = [
    {
      id: "a_1",
      kind: "album",
      contentKind: "photo",
      name: "2023年相册",
      displayName: "2023年相册",
      imageCount: 3,
      coverImages: [],
    },
    {
      id: "a_2",
      kind: "album",
      contentKind: "photo",
      name: "2024年相册",
      displayName: "2024年相册",
      imageCount: 5,
      coverImages: [],
    },
  ];
  mocks.listItems = [mocks.items[0]];
  renderHome("/?year=2023");
  await waitFor(() => expect(screen.getByTestId("album-grid")).toBeTruthy());
  expect(screen.getByRole("button", { name: /^全部/ }).textContent).toContain(
    "1",
  );
  expect(screen.getByRole("button", { name: /^相册/ }).textContent).toContain(
    "1",
  );
});

// 漫画侧的主索引是「作品」，年份只是附带的筛选：只剩「其他」一桶时，
// 那一段索引筛不出任何东西，是装饰不是索引。
// （照片侧不同：年份是那一侧的主索引，有内容就摆。）
it("漫画侧只有「其他」一桶时不摆时间线", async () => {
  mocks.items = [
    {
      id: "a_1",
      kind: "album",
      contentKind: "comic",
      name: "第1卷",
      displayName: "第1卷",
      imageCount: 10,
      coverImages: [],
    },
  ];
  renderHome();
  await waitFor(() => expect(screen.getByTestId("album-grid")).toBeTruthy());
  expect(screen.queryByTestId("year-timeline")).toBeNull();
});
