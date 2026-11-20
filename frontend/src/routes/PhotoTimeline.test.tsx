import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import PhotoTimeline from "./PhotoTimeline";

const feed = vi.hoisted(() => ({
  items: [] as {
    id: string;
    kind: "image" | "video";
    name: string;
    index: number;
    kindIndex: number;
    albumId: string;
    albumName: string;
    capturedAt?: string;
    dateSource?: string;
  }[],
  years: [] as {
    year: number;
    count: number;
    months: { month: number; count: number }[];
  }[],
  unknown: 0,
  dateSources: {} as Record<string, number>,
  total: 0,
  lastQuery: undefined as unknown,
  photoAlbumCount: 3,
  comicAlbumCount: 0,
  historyCards: [] as { to: string; title: string }[],
}));

vi.mock("../hooks/useMediaFeed", () => ({
  useMediaFeed: (query: unknown) => {
    feed.lastQuery = query;
    return {
      items: feed.items,
      albums: [],
      sources: [],
      years: feed.years,
      unknown: feed.unknown,
      dateSources: feed.dateSources,
      total: feed.total,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
    };
  },
}));

// 虚拟列表在 jsdom 里没有尺寸：直接渲染全部条目。
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(
    (
      {
        data,
        itemContent,
      }: {
        data: {
          kind: string;
          key: string;
          group?: string;
          row?: {
            height: number;
            tileHeight: number;
            tiles: { id: string; ratio: number; width: number }[];
          };
        }[];
        itemContent: (index: number, entry: never) => ReactNode;
      },
      _ref: unknown,
    ) => (
      <>
        {data.map((entry, index) => (
          <div key={entry.key}>{itemContent(index, entry as never)}</div>
        ))}
      </>
    ),
  ),
}));

// 照片墙按容器宽度排布：测试里给一个固定宽度。
vi.mock("../hooks/useElementSize", () => ({
  useElementSize: () => ({ ref: { current: null }, width: 1200, height: 800 }),
}));

vi.mock("../hooks/usePicks", () => ({
  usePicks: () => ({
    isPicked: () => false,
    toggle: vi.fn(),
    total: 0,
    isLoading: false,
  }),
}));

vi.mock("../hooks/useHistory", () => ({
  useHistoryCards: () => ({ cards: feed.historyCards }),
}));

vi.mock("../hooks/useLibrary", () => ({
  useLibraryManifest: () => ({
    data: {
      manifest: {
        statistics: {
          albumCount: 3,
          photoAlbumCount: feed.photoAlbumCount,
          comicAlbumCount: feed.comicAlbumCount,
        },
      },
    },
    isLoading: false,
  }),
  useOnThisDayAlbums: () => ({
    data: { page: { items: [], total: 0 } },
  }),
}));

beforeEach(() => {
  feed.items = [
    {
      id: "f_1",
      kind: "image",
      name: "1.jpg",
      index: 0,
      kindIndex: 0,
      albumId: "a_1",
      albumName: "第一本",
      capturedAt: "2024-05-04T10:00:00Z",
      dateSource: "exif",
    },
    {
      id: "f_2",
      kind: "image",
      name: "2.jpg",
      index: 1,
      kindIndex: 1,
      albumId: "a_2",
      albumName: "第二本",
      capturedAt: "2023-08-09T10:00:00Z",
      dateSource: "filename",
    },
    {
      id: "f_3",
      kind: "image",
      name: "3.jpg",
      index: 2,
      kindIndex: 2,
      albumId: "a_3",
      albumName: "第三本",
      capturedAt: "2021-02-03T00:00:00Z",
      dateSource: "modified",
    },
  ];
  feed.years = [
    {
      year: 2024,
      count: 1,
      months: [{ month: 5, count: 1 }],
    },
    {
      year: 2023,
      count: 1,
      months: [{ month: 8, count: 1 }],
    },
  ];
  feed.unknown = 1;
  feed.dateSources = { exif: 1, filename: 1, modified: 1 };
  feed.total = 3;
  feed.lastQuery = undefined;
  feed.photoAlbumCount = 3;
  feed.comicAlbumCount = 0;
  feed.historyCards = [];
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderTimeline(entry = "/photo") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/photo" element={<PhotoTimeline />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

// 时间线按月份分段，每段标题写清是几月。
it("时间线按月份分段，标题写清是几月", async () => {
  renderTimeline();
  const headers = await screen.findAllByTestId("timeline-group-header");
  expect(headers.map((node) => node.textContent)).toEqual([
    "2024 年 5 月1 张",
    "2023 年 8 月1 张· 含推断时间",
    "日期未知1 张· 只有文件修改时间，不是拍摄时间",
  ]);
});

// 段落的数量取自年份索引：墙上显示的张数是那一段的总数，不是已加载的那几页。
it("段落数量取自年份索引", async () => {
  feed.years = [{ year: 2024, count: 320, months: [{ month: 5, count: 320 }] }];
  feed.items = [feed.items[0]];
  renderTimeline();
  const header = await screen.findByTestId("timeline-group-header");
  expect(header.textContent).toContain("320 张");
});

// 从文件名推断出来的月份必须标出来：它不是拍摄时间。
it("推断出来的月份会标出来", async () => {
  renderTimeline();
  const notes = await screen.findAllByTestId("timeline-group-note");
  expect(notes.map((node) => node.textContent)).toContain("· 含推断时间");
});

// 没有拍摄证据的那一段单独摆着，不混进任何一年。
it("没有拍摄证据的那一段单独摆着", async () => {
  renderTimeline();
  const headers = await screen.findAllByTestId("timeline-group-header");
  expect(headers.some((node) => node.textContent?.includes("日期未知"))).toBe(
    true,
  );
  const notes = await screen.findAllByTestId("timeline-group-note");
  expect(
    notes.some((node) =>
      node.textContent?.includes("只有文件修改时间，不是拍摄时间"),
    ),
  ).toBe(true);
});

// 顶部的来源说明照实说这一段时间是怎么来的。
it("顶部说明时间来源的分布", async () => {
  renderTimeline();
  const legend = await screen.findByTestId("timeline-source-legend");
  expect(legend.textContent).toContain("拍摄时间 1 张");
  expect(legend.textContent).toContain("文件名推断 1 张");
});

// 跳年：年份进地址栏，服务端按年取材。
it("跳年会把年份写进地址栏", async () => {
  renderTimeline();
  fireEvent.change(screen.getByLabelText("年份"), {
    target: { value: "2023" },
  });
  await waitFor(() =>
    expect(screen.getByTestId("location").textContent).toBe("?year=2023"),
  );
  expect(feed.lastQuery).toMatchObject({ year: "2023" });
});

// 跳年之后才有月份可选：月份只在年份之内有意义。
it("选中年份后可以再选月份", async () => {
  renderTimeline("/photo?year=2024");
  fireEvent.change(screen.getByLabelText("月份"), { target: { value: "5" } });
  await waitFor(() =>
    expect(screen.getByTestId("location").textContent).toBe(
      "?year=2024&month=5",
    ),
  );
  expect(feed.lastQuery).toMatchObject({ year: "2024", month: "5" });
});

// 照片与视频可以分开看。
it("可以只看视频", async () => {
  renderTimeline();
  fireEvent.click(screen.getByRole("button", { name: "视频" }));
  await waitFor(() =>
    expect(screen.getByTestId("location").textContent).toBe("?media=video"),
  );
  expect(feed.lastQuery).toMatchObject({ media: "video" });
});

// 「日期未知」那一段有自己的入口：它不是某一年。
it("可以单独看日期未知的那一段", async () => {
  renderTimeline();
  fireEvent.change(screen.getByLabelText("年份"), {
    target: { value: "unknown" },
  });
  await waitFor(() =>
    expect(screen.getByTestId("location").textContent).toBe("?year=unknown"),
  );
  expect(feed.lastQuery).toMatchObject({ year: "unknown" });
});

// 清除筛选回到整条时间线。
it("清除筛选回到整条时间线", async () => {
  renderTimeline("/photo?year=2024&media=video");
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  await waitFor(() =>
    expect(screen.getByTestId("location").textContent).toBe(""),
  );
});

// 首页给得出通往相册的明确入口：目录结构在相册里，不在时间线上。
it("有通往相册的明确入口", async () => {
  renderTimeline();
  const link = screen.getByRole("link", { name: "相册" });
  expect(link).toHaveAttribute("href", "/photo/library");
});

// 「接着看」保留为一条紧凑的入口，不再是一整块专区。
it("「接着看」保留为一条紧凑的入口", async () => {
  feed.historyCards = [{ to: "/photo/albums/a_1", title: "2023年海边" }];
  renderTimeline();
  const link = screen.getByRole("link", { name: /接着看/ });
  expect(link).toHaveAttribute("href", "/photo/albums/a_1");
});

// 这一侧没有内容时，给出与「库里有内容但这一侧没有」不一样的引导。
it("这一侧没有内容时给出引导", async () => {
  feed.photoAlbumCount = 0;
  feed.comicAlbumCount = 1;
  renderTimeline();
  expect(screen.getByText("照片这边还没有内容")).toBeTruthy();
  expect(screen.getByRole("link", { name: "去漫画库看看" })).toHaveAttribute(
    "href",
    "/comic",
  );
});
