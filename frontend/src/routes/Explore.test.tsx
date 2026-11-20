import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { aiJobsApi, type AIJob, type ChinaPlace } from "../api/aiJobs";
import { albumsApi } from "../api/albums";
import Explore from "./Explore";

const mocks = vi.hoisted(() => ({
  manifest: undefined as unknown,
  libraryList: undefined as unknown,
  featuredDirectory: undefined as unknown,
  allDirectory: undefined as unknown,
  places: undefined as unknown,
}));

vi.mock("../hooks/useLibrary", () => ({
  useLibraryManifest: () => mocks.manifest,
}));
vi.mock("../hooks/useLibraryList", async (original) => ({
  ...(await original<typeof import("../hooks/useLibraryList")>()),
  useLibraryList: () => mocks.libraryList,
}));
vi.mock("../hooks/useSmartAlbums", () => ({
  useSmartAlbumDirectory: (dimension: string) =>
    dimension === "featured" ? mocks.featuredDirectory : mocks.allDirectory,
}));
vi.mock("../hooks/useChinaLocations", () => ({
  useChinaPlacesAll: () => ({
    data: mocks.places as ChinaPlace[] | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("../api/aiJobs", async (original) => {
  const actual = await original<typeof import("../api/aiJobs")>();
  return {
    ...actual,
    aiJobsApi: {
      ...actual.aiJobsApi,
      list: vi.fn(),
      people: vi.fn(),
      chinaLocations: vi.fn(),
    },
  };
});
vi.mock("../api/albums", async (original) => {
  const actual = await original<typeof import("../api/albums")>();
  return {
    ...actual,
    albumsApi: {
      ...actual.albumsApi,
      smartAlbumRefreshActive: vi.fn(),
    },
  };
});

const manifest = {
  revision: 1,
  scannedAt: "2026-11-18T10:00:00Z",
  duration: 1,
  roots: [],
  statistics: {
    rootCount: 1,
    albumCount: 1,
    photoAlbumCount: 1,
    comicAlbumCount: 0,
    photoCollectionCount: 0,
    comicCollectionCount: 0,
    collectionCount: 0,
    tagCount: 0,
    warningCount: 0,
  },
};

const peopleResponse = {
  ok: true,
  people: [],
  totalGroups: 0,
  limit: 100,
  centroidThreshold: 0.7,
  anchorThreshold: 0.75,
  sort: "photos" as const,
  revision: 1,
};

const jobsResponse = {
  ok: true,
  snapshot: {
    jobs: [],
    queue: [],
    settings: {
      dailyEnabled: false,
      dailyTime: "03:00",
      dailyModules: [],
      dailyScan: false,
      dailySmartAlbums: false,
      peopleEnabled: false,
      gpuEnabled: false,
    },
    modules: [],
  },
};

function analysisJob(type: AIJob["type"], status: AIJob["status"]): AIJob {
  return {
    id: `job-${type}`,
    type,
    mode: "full",
    status,
    stage: "complete",
    moduleVersion: "test-v1",
    total: 1,
    processed: 1,
    skipped: 0,
    failed: 0,
    done: 1,
    checkpoint: { offset: 1, batch: 1, moduleVersion: "test-v1" },
    computeDevice: "cpu",
    planned: 1,
    completed: 1,
    estimatedRemainingMs: 0,
    elapsedMs: 1,
    speedPerSecond: 1,
    createdAt: "2026-11-18T10:00:00Z",
    updatedAt: "2026-11-18T10:00:01Z",
  };
}

function jobsWith(job: AIJob, peopleEnabled = false) {
  return {
    ...jobsResponse,
    snapshot: {
      ...jobsResponse.snapshot,
      settings: { ...jobsResponse.snapshot.settings, peopleEnabled },
      jobs: [job],
    },
  };
}

function queryState(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderExplore() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/photo/explore"]}>
        <Explore />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.manifest = queryState({ data: { manifest } });
  mocks.libraryList = {
    ...queryState(),
    summary: { years: [], imageTotal: 4 },
    query: { kind: "photo", view: "all" },
  };
  mocks.featuredDirectory = {
    ...queryState(),
    items: [],
    total: 0,
    analysis: { totalAlbums: 1, analyzedAlbums: 0, complete: false },
  };
  mocks.allDirectory = {
    ...queryState(),
    items: [],
    total: 0,
    analysis: { totalAlbums: 1, analyzedAlbums: 0, complete: false },
  };
  mocks.places = [];
  vi.mocked(aiJobsApi.people).mockResolvedValue(peopleResponse);
  vi.mocked(aiJobsApi.list).mockResolvedValue(jobsResponse);
  vi.mocked(albumsApi.smartAlbumRefreshActive).mockResolvedValue({
    ok: true,
    task: null,
  });
});

it("仅有漫画相册时按照片统计显示探索空态，不加载照片分区", () => {
  mocks.manifest = queryState({
    data: {
      manifest: {
        ...manifest,
        statistics: {
          ...manifest.statistics,
          photoAlbumCount: 0,
          comicAlbumCount: 1,
        },
      },
    },
  });

  renderExplore();

  expect(screen.getByText("照片库还没有相册")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "去漫画库看看" })).toHaveAttribute(
    "href",
    "/comic",
  );
  expect(aiJobsApi.people).not.toHaveBeenCalled();
});

it("manifest 加载失败时展示重试，不误报照片库为空", () => {
  mocks.manifest = queryState({
    data: undefined,
    isLoading: false,
    isError: true,
  });

  renderExplore();

  expect(screen.getByText("照片库信息暂时读不出来。")).toBeInTheDocument();
  expect(screen.queryByText("照片库还没有相册")).toBeNull();
});

it("照片库信息加载时显示进度，不把加载中当成空库", () => {
  mocks.manifest = queryState({ data: undefined, isLoading: true });

  renderExplore();

  expect(screen.getByText("正在读取照片库信息…")).toBeInTheDocument();
  expect(screen.queryByText("照片库还没有相册")).toBeNull();
});

it("首屏先给找法：搜索入口与四个维度", () => {
  renderExplore();

  expect(screen.getByText("我要找什么")).toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "发现维度" });
  for (const label of ["时间", "人物", "地点", "主题"]) {
    expect(
      within(nav).getByRole("link", { name: label }),
    ).toBeInTheDocument();
  }
});

it("顶部搜索按名称进入名称结果页", async () => {
  renderExplore();

  fireEvent.change(screen.getByRole("textbox", { name: "搜索" }), {
    target: { value: "海边 日落" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));

  await waitFor(() => {
    const location = new URL(
      screen.getByTestId("location").textContent ?? "",
      "http://local",
    );
    expect(location.pathname).toBe("/photo/search");
    expect(location.searchParams.get("q")).toBe("海边 日落");
    expect(location.searchParams.get("scope")).toBeNull();
  });
});

it("顶部搜索切到画面与文字后带上作用域", async () => {
  renderExplore();

  fireEvent.click(screen.getByRole("radio", { name: "画面与文字" }));
  fireEvent.change(screen.getByRole("textbox", { name: "搜索" }), {
    target: { value: "雪" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));

  await waitFor(() => {
    const location = new URL(
      screen.getByTestId("location").textContent ?? "",
      "http://local",
    );
    expect(location.pathname).toBe("/photo/search");
    expect(location.searchParams.get("q")).toBe("雪");
    expect(location.searchParams.get("scope")).toBe("content");
  });
});

it("人物预览把已命名与候选分组分开摆", async () => {
  vi.mocked(aiJobsApi.people).mockResolvedValue({
    ...peopleResponse,
    people: [
      {
        id: "p_named",
        name: "小明",
        faceCount: 6,
        photoCount: 5,
        coverResourceId: "f_named",
        confirmed: true,
        hidden: false,
      },
      {
        id: "p_candidate",
        name: "人物 1",
        faceCount: 2,
        photoCount: 2,
        coverResourceId: "f_candidate",
        confirmed: false,
        hidden: false,
      },
    ],
    totalGroups: 2,
  });
  vi.mocked(aiJobsApi.list).mockResolvedValue(
    jobsWith(analysisJob("face", "completed"), true),
  );

  renderExplore();

  expect(await screen.findByText("已命名")).toBeInTheDocument();
  expect(screen.getByText("候选分组")).toBeInTheDocument();
  expect(
    screen.getByText("相似度聚出来的，还没确认是谁"),
  ).toBeInTheDocument();
  expect(screen.getByText("小明")).toBeInTheDocument();
  expect(screen.getByText("人物 1")).toBeInTheDocument();
});

it("人物预览优先露出代表脸", async () => {
  vi.mocked(aiJobsApi.people).mockResolvedValue({
    ...peopleResponse,
    people: [
      {
        id: "p_face",
        name: "人物 1",
        faceCount: 3,
        photoCount: 3,
        coverResourceId: "f_whole",
        coverFace: {
          resourceId: "f_face",
          box: [10, 20, 30, 40],
          width: 800,
          height: 600,
        },
        confirmed: false,
        hidden: false,
      },
    ],
    totalGroups: 1,
  });
  vi.mocked(aiJobsApi.list).mockResolvedValue(
    jobsWith(analysisJob("face", "completed"), true),
  );

  renderExplore();

  const thumb = await screen.findByTestId("explore-person-thumbnail");
  expect(thumb).toHaveAttribute("src", expect.stringContaining("f_face"));
  expect(thumb.getAttribute("src")).not.toContain("f_whole");
});

it("区分人物分析尚未启用与已分析但没有候选", async () => {
  const { unmount } = renderExplore();
  expect(await screen.findByText(/人物分析尚未启用/)).toBeInTheDocument();
  unmount();

  vi.mocked(aiJobsApi.list).mockResolvedValue(
    jobsWith(analysisJob("face", "completed"), true),
  );
  renderExplore();
  expect(
    await screen.findByText(/人脸分析已完成，目前没有形成可用的候选分组/),
  ).toBeInTheDocument();
});

it("地点预览列出可进入的地点", async () => {
  mocks.places = [
    {
      adcode: 330100,
      name: "杭州市",
      level: "city",
      photoCount: 128,
      unmatchedCount: 0,
      visitCount: 3,
      firstAt: "2023-05-01",
      lastAt: "2023-05-05",
      coverResourceIds: ["f_hz"],
    },
  ];

  renderExplore();

  const link = await screen.findByRole("link", { name: /杭州市/ });
  expect(link).toHaveAttribute("href", "/photo/travels/place/330100");
  expect(screen.getByText(/128 张/)).toBeInTheDocument();
});

it("地点没有解析结果时区分尚未分析与分析完成但没有位置", async () => {
  const first = renderExplore();
  expect(
    await screen.findByText(/尚未完成元数据 \/ GPS 分析/),
  ).toBeInTheDocument();
  first.unmount();

  vi.mocked(aiJobsApi.list).mockResolvedValue(
    jobsWith(analysisJob("metadata", "completed")),
  );
  renderExplore();
  expect(
    await screen.findByText(
      "元数据分析已完成，目前没有解析出可用于足迹的位置。",
    ),
  ).toBeInTheDocument();
});

it("主题预览写清标题、张数与来源", async () => {
  mocks.featuredDirectory = {
    ...queryState(),
    items: [
      {
        albumId: "a_trip",
        albumName: "2019 旅行",
        parentName: "旅行",
        group: {
          id: "g_1",
          dimension: "recommended",
          name: "海边的日落",
          suggestedName: "海边的日落",
          customName: false,
          photoCount: 24,
          evidenceDimensions: ["time", "place"],
          coverResourceId: "f_sunset",
          hidden: false,
        },
      },
    ],
    total: 1,
  };

  renderExplore();

  expect(await screen.findByText("海边的日落")).toBeInTheDocument();
  expect(screen.getByText(/24 张 · 来自 旅行 \/ 2019 旅行/)).toBeInTheDocument();
  expect(screen.getByText("线索：时间 · 地点")).toBeInTheDocument();
});

it("主题区区分尚未生成与分析完成但没有分组", async () => {
  const first = renderExplore();
  expect(await screen.findByText("主题尚未生成。")).toBeInTheDocument();
  first.unmount();

  mocks.allDirectory = {
    ...queryState(),
    items: [],
    total: 0,
    analysis: { totalAlbums: 1, analyzedAlbums: 1, complete: true },
  };
  renderExplore();
  expect(
    await screen.findByText("主题分析已完成，目前没有形成可用的分类分组。"),
  ).toBeInTheDocument();
});

it("年份索引请求失败时保留分区并提供重试", () => {
  mocks.libraryList = {
    ...queryState({ data: undefined, isError: true }),
    summary: undefined,
    query: { kind: "photo", view: "all" },
  };

  renderExplore();

  expect(screen.getByText("年份索引暂时读不出来。")).toBeInTheDocument();
});
