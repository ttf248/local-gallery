import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import SearchResults from "./SearchResults";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  semanticSearch: vi.fn(),
  embeddingStatus: vi.fn(),
}));

vi.mock("../api/albums", async (original) => {
  const actual = await original<typeof import("../api/albums")>();
  return {
    ...actual,
    albumsApi: { ...actual.albumsApi, search: mocks.search },
  };
});

vi.mock("../api/aiJobs", async (original) => {
  const actual = await original<typeof import("../api/aiJobs")>();
  return {
    ...actual,
    aiJobsApi: {
      ...actual.aiJobsApi,
      embeddingStatus: mocks.embeddingStatus,
      semanticSearch: mocks.semanticSearch,
    },
  };
});

vi.mock("../hooks/useLibrary", () => ({
  useLibraryNodes: () => ({ data: { items: [] } }),
}));

vi.mock("../features/wall/PhotoWall", () => ({
  default: () => <div data-testid="photo-wall" />,
}));

// 真实网格是虚拟化的，jsdom 里量不出高度、不会渲染卡片；
// 这里换成普通列表，才能验到卡片上的说明。
vi.mock("../features/library/AlbumGrid", () => ({
  default: ({
    items,
    note,
  }: {
    items: { id: string }[];
    note?: (item: { id: string }) => React.ReactNode;
  }) => (
    <ul data-testid="album-grid">
      {items.map((item) => (
        <li key={item.id}>{note?.(item)}</li>
      ))}
    </ul>
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderResults(entry = "/photo/search?q=旅行") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <SearchResults />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search.mockResolvedValue({
    ok: true,
    count: 1,
    results: [
      {
        kind: "album",
        path: "a_trip",
        name: "旅行册",
        count: 12,
        match: "prefix",
      },
    ],
  });
  mocks.embeddingStatus.mockResolvedValue({
    ok: true,
    status: {
      runtimeReady: true,
      modelValid: true,
      device: "cpu",
      coverage: { indexed: 120, total: 200 },
    },
  });
  mocks.semanticSearch.mockResolvedValue({
    ok: true,
    results: [],
    total: 0,
    offset: 0,
    nextOffset: 0,
    revision: 1,
  });
});

it("名称结果说清搜的是名字，并给出返回与清除条件", async () => {
  renderResults();

  expect(screen.getByText("正在搜相册、文件夹与标签的名字")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "清除条件" })).toBeInTheDocument();
  // 命中理由：用户看得到「为什么是它」。
  expect(await screen.findByText("名字以关键词开头")).toBeInTheDocument();
});

it("清除条件把关键词从地址里去掉", async () => {
  renderResults();

  fireEvent.click(screen.getByRole("button", { name: "清除条件" }));

  await waitFor(() => {
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/photo/search",
    );
    expect(screen.getByTestId("location").textContent).not.toContain("q=");
  });
});

it("切到画面与文字时换掉检索对象，并保留关键词", async () => {
  renderResults();

  fireEvent.click(screen.getByRole("radio", { name: "画面与文字" }));

  await waitFor(() => {
    const location = new URL(
      screen.getByTestId("location").textContent ?? "",
      "http://local",
    );
    expect(location.searchParams.get("scope")).toBe("content");
    expect(location.searchParams.get("q")).toBe("旅行");
  });
  expect(
    screen.getByText("正在搜照片里的画面与图片文字"),
  ).toBeInTheDocument();
});

it("画面结果没有命中时说清是画面索引还没建好", async () => {
  mocks.embeddingStatus.mockResolvedValue({
    ok: true,
    status: {
      runtimeReady: true,
      modelValid: true,
      device: "cpu",
      coverage: { indexed: 0, total: 200 },
    },
  });
  renderResults("/photo/search?q=旅行&scope=content");

  expect(await screen.findByText("还没有建立画面索引")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "打开任务中心" }),
  ).toBeInTheDocument();
});

it("画面搜索失败与没有结果是两回事", async () => {
  mocks.semanticSearch.mockRejectedValue(new Error("boom"));
  renderResults("/photo/search?q=旅行&scope=content");

  expect(await screen.findByText("搜索失败")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "重新搜索" }),
  ).toBeInTheDocument();
});

it("没有关键词时给出去哪找的入口", () => {
  renderResults("/photo/search");

  expect(screen.getByText("还没有搜索")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "去发现页找东西" }),
  ).toHaveAttribute("href", "/photo/explore");
});
