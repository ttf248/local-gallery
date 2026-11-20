import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { aiJobsApi, type AIJob } from "../api/aiJobs";
import { albumsApi } from "../api/albums";
import Explore from "./Explore";

const mocks = vi.hoisted(() => ({
  manifest: undefined as unknown,
  libraryList: undefined as unknown,
  featuredDirectory: undefined as unknown,
  allDirectory: undefined as unknown,
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
  vi.mocked(aiJobsApi.people).mockResolvedValue(peopleResponse);
  vi.mocked(aiJobsApi.list).mockResolvedValue(jobsResponse);
  vi.mocked(aiJobsApi.chinaLocations).mockResolvedValue({
    ok: true,
    locations: {
      revision: 1,
      boundaryVersion: "test",
      gpsPhotoCount: 0,
      chinaPhotoCount: 0,
      unassignedPhotoCount: 0,
      totalPhotoCount: 4,
      provinces: [],
      months: [],
      trajectory: [],
      untimedPhotoCount: 0,
      provinceCount: 0,
      cityCount: 0,
      districtCount: 0,
    },
  });
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
  expect(aiJobsApi.chinaLocations).not.toHaveBeenCalled();
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

it("人物和地点请求失败时分别显示可重试错误，不落入未分析空态", async () => {
  vi.mocked(aiJobsApi.people).mockRejectedValue(new Error("people offline"));
  vi.mocked(aiJobsApi.chinaLocations).mockRejectedValue(
    new Error("locations offline"),
  );

  renderExplore();

  expect(await screen.findByText("人物分组暂时读不出来。")).toBeInTheDocument();
  expect(await screen.findByText("地点数据暂时读不出来。")).toBeInTheDocument();
  expect(screen.queryByText(/人物分析尚未/)).toBeNull();
  expect(screen.queryByText(/还没有解析出照片里的位置/)).toBeNull();
});

it("人物预览展示照片缩略图并明确标为候选分组", async () => {
  vi.mocked(aiJobsApi.people).mockResolvedValue({
    ...peopleResponse,
    people: [
      {
        id: "p_1",
        name: "人物 1",
        faceCount: 6,
        photoCount: 5,
        coverResourceId: "f_cover",
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

  expect(await screen.findByText("候选分组")).toBeInTheDocument();
  expect(screen.getByTestId("explore-person-thumbnail")).toHaveAttribute(
    "src",
    expect.stringContaining("f_cover"),
  );
  expect(
    screen.getByText("相似度分组只是复核线索，不代表身份确认。"),
  ).toBeInTheDocument();
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

it("地点区分尚未分析与分析完成但没有 GPS 位置", async () => {
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

it("内容搜索提交后把关键词带到现有语义搜索页", async () => {
  renderExplore();

  fireEvent.change(screen.getByRole("textbox", { name: "搜索照片内容" }), {
    target: { value: "海边 日落" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索照片" }));

  await waitFor(() => {
    const location = new URL(
      screen.getByTestId("location").textContent ?? "",
      "http://local",
    );
    expect(location.pathname).toBe("/photo/semantic");
    expect(location.searchParams.get("q")).toBe("海边 日落");
  });
});
