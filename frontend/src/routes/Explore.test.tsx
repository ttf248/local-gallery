import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { aiJobsApi, type AIJob, type ChinaPlace } from "../api/aiJobs";
import { albumsApi } from "../api/albums";
import { WithTopBar } from "../../tests/WithTopBar";
import Explore from "./Explore";

const mocks = vi.hoisted(() => ({
  manifest: undefined as unknown,
  libraryList: undefined as unknown,
  timelineFeed: undefined as unknown,
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
vi.mock("../hooks/useMediaFeed", () => ({
  useMediaFeed: () => mocks.timelineFeed,
}));
vi.mock("../hooks/useSmartAlbums", async (original) => ({
  ...(await original<typeof import("../hooks/useSmartAlbums")>()),
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

function renderExplore() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/photo/explore"]}>
        <WithTopBar><Explore /></WithTopBar>
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
  mocks.timelineFeed = { ...queryState(), years: [] };
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

  const bar = within(screen.getByTestId("top-bar"));
  expect(bar.getByRole("button", { name: "打开命令面板" })).toBeVisible();
  screen.getByRole("searchbox",{name:"搜索照片库"}).focus();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("searchbox",{name:"搜索照片库"})).toHaveAttribute("aria-haspopup","dialog");
  expect(screen.getByRole("radiogroup", { name: "搜索范围" })).toBeVisible();
  for (const [label, destination] of [["人物","全部人物"],["地点","足迹"],["时间","时间线"],["主题","全部主题"]]) {
    const section=screen.getByRole("region",{name:label});
    expect(within(section).getByRole("link",{name:destination})).toBeInTheDocument();
  }
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
  expect(screen.getByText("相似度聚出来的，还没确认是谁")).toBeInTheDocument();
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
  expect(thumb).toHaveAttribute("sizes", "800px");
  // 竖拍合照的文件头是横向尺寸，而人脸框已经按 EXIF 转正。
  Object.defineProperties(thumb, {
    naturalWidth: { value: 480 },
    naturalHeight: { value: 640 },
  });
  fireEvent.load(thumb);
  expect(thumb).toHaveAttribute("sizes", "600px");
  expect(thumb).toHaveStyle({ width: "1200%", height: "1600%" });
});

it("区分人物分析尚未启用与已分析但没有候选", async () => {
  const { unmount } = renderExplore();
  expect(await screen.findByText(/开启智能整理，按人物、地点与主题自动归类/)).toBeVisible();
  expect(screen.queryByText(/人物分析尚未启用/)).toBeNull();
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
    await screen.findByText(/开启智能整理，按人物、地点与主题自动归类/),
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
  expect(
    screen.getByText(/24 张 · 来自 旅行 \/ 2019 旅行/),
  ).toBeInTheDocument();
  // 线索不再逐张卡片挂一行灰字，收进悬停提示里。
  expect(screen.getByTitle("线索：时间 · 地点")).toBeInTheDocument();
  // 点进去落到那一组照片：分组是相册里照片的一种看法，地址带维度与组 id。
  const link = screen.getByRole("link", { name: /海边的日落/ });
  expect(link).toHaveAttribute(
    "href",
    "/photo/albums/a_trip?dimension=recommended&group=g_1",
  );
});

it("主题区区分尚未生成与分析完成但没有分组", async () => {
  const first = renderExplore();
  expect(await screen.findByText(/开启智能整理，按人物、地点与主题自动归类/)).toBeVisible();
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
  mocks.timelineFeed = {
    ...queryState({ data: undefined, isError: true }),
    years: [],
  };

  renderExplore();

  expect(screen.getByText("年份索引暂时读不出来。")).toBeInTheDocument();
});
