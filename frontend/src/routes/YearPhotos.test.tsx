import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import YearPhotos from "./YearPhotos";

const feed = vi.hoisted(() => ({
  items: [] as {
    id: string;
    kind: "image";
    name: string;
    index: number;
    kindIndex: number;
    albumId: string;
    albumName: string;
  }[],
  albums: [] as { id: string; name: string; count: number }[],
  sources: [] as { id: string; name: string; kind: string }[],
  total: 0,
  isLoading: false,
  isError: false,
  isFetching: false,
  isFetchNextPageError: false,
  cursorInvalidated: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  refetch: vi.fn(),
  retryNextPage: vi.fn(),
  query: null as unknown,
}));

vi.mock("../hooks/useMediaFeed", () => ({
  useMediaFeed: (query: unknown) => {
    feed.query = query;
    return feed;
  },
}));

// 虚拟列表在 jsdom 里没有尺寸：换成直接渲染全部行。
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(
    (
      {
        data,
        itemContent,
      }: {
        data: {
          key: string;
          height: number;
          tileHeight: number;
          tiles: { id: string; ratio: number; width: number }[];
        }[];
        itemContent: (index: number, row: never) => ReactNode;
      },
      _ref: unknown,
    ) => (
      <>
        {data.map((row, index) => (
          <div key={row.key}>{itemContent(index, row as never)}</div>
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

beforeEach(() => {
  feed.isLoading = false;
  feed.isError = false;
  feed.isFetching = false;
  feed.isFetchNextPageError = false;
  feed.cursorInvalidated = false;
  feed.hasNextPage = false;
  feed.isFetchingNextPage = false;
  feed.refetch.mockReset();
  feed.retryNextPage.mockReset();
  feed.items = [
    {
      id: "f_1",
      kind: "image",
      name: "1.jpg",
      index: 0,
      kindIndex: 0,
      albumId: "a_1",
      albumName: "第一本",
    },
  ];
  feed.albums = [{ id: "a_1", name: "第一本", count: 1 }];
  feed.sources = [{ id: "c_1", name: "2024年", kind: "collection" }];
  feed.total = 449;
});

function yearTree() {
  return (
    <MemoryRouter initialEntries={["/photo/years/2024"]}>
      <Routes>
        <Route path="/photo/years/:year" element={<YearPhotos />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderYear() {
  return render(yearTree());
}

it("页头说清是哪一年、多少张、来自几本相册", async () => {
  renderYear();
  expect(screen.getByRole("heading", { name: "2024 年目录照片" })).toBeTruthy();
  expect(screen.getByText("按相册目录年份浏览")).toBeTruthy();
  await waitFor(() => expect(screen.getByText(/449 张/)).toBeTruthy());
  expect(screen.getByText(/来自/)).toBeTruthy();
});

it("旧年份深链仍使用目录年份范围", () => {
  renderYear();
  expect(feed.query).toEqual({ kind: "photo", scope: "year", year: "2024" });
});

it("首屏失败提供可点击的重试操作", () => {
  feed.items = [];
  feed.albums = [];
  feed.sources = [];
  feed.total = 0;
  feed.isError = true;

  renderYear();
  fireEvent.click(screen.getByRole("button", { name: "重试加载" }));

  expect(feed.refetch).toHaveBeenCalledTimes(1);
});

it("后续分页失败保留照片，重试成功后无重复或遗漏", async () => {
  feed.isError = true;
  feed.isFetchNextPageError = true;
  feed.hasNextPage = true;

  const view = renderYear();

  expect(
    await screen.findByText("后续照片加载失败，已加载的目录年份照片仍可浏览。"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "查看 1.jpg" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
  expect(feed.retryNextPage).toHaveBeenCalledTimes(1);

  feed.items = [
    feed.items[0],
    {
      id: "f_2",
      kind: "image",
      name: "2.jpg",
      index: 1,
      kindIndex: 1,
      albumId: "a_1",
      albumName: "第一本",
    },
  ];
  feed.total = 2;
  feed.isError = false;
  feed.isFetchNextPageError = false;
  feed.hasNextPage = false;
  view.rerender(yearTree());

  expect(screen.getAllByRole("button", { name: "查看 1.jpg" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "查看 2.jpg" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: /^查看 / })).toHaveLength(2);
});

it("来源集合给出回到集合的入口", async () => {
  renderYear();
  const link = screen.getByRole("link", { name: "2024年" });
  expect(link.getAttribute("href")).toBe("/photo/albums/c_1");
});

it("照片墙标出每张照片出自哪本相册", async () => {
  renderYear();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "查看 1.jpg" })).toBeTruthy(),
  );
  // 悬停信息层显示相册名：跨相册的墙上，用户先要知道自己看的是哪本。
  expect(screen.getByText("第一本")).toBeTruthy();
});
