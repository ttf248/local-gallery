import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import PhotoAlbum from "./PhotoAlbum";
import { useAlbumFilters, useAlbumMedia } from "../hooks/useLibrary";
import {
  useSmartAlbumGroupMedia,
  useSmartAlbumGroups,
} from "../hooks/useSmartAlbums";
import { useFavorites } from "../hooks/useFavorites";
import { fsApi } from "../api/fs";
import { ApiError } from "../api/client";
import { aiJobsApi } from "../api/aiJobs";
import { useUIStore } from "../store/uiStore";
import { usePhotoSelectionStore } from "../store/photoSelectionStore";

vi.mock("../hooks/useLibrary", () => ({
  useAlbumMedia: vi.fn(),
  useAlbumFilters: vi.fn(),
  useLibraryChildren: vi.fn(),
  useLibraryNodes: vi.fn(),
  useTagAlbums: vi.fn(),
}));
vi.mock("../hooks/useFavorites", () => ({ useFavorites: vi.fn() }));
vi.mock("../hooks/useSmartAlbums", () => ({
  useSmartAlbumGroups: vi.fn(),
  useSmartAlbumGroupMedia: vi.fn(),
}));
vi.mock("../api/fs", () => ({
  fsApi: {
    capabilities: vi.fn().mockResolvedValue({ allowOsOpen: false }),
    openInExplorer: vi.fn().mockResolvedValue({ ok: true }),
  },
}));
vi.mock("../api/aiJobs", () => ({
  aiJobsApi: {
    list: vi.fn(),
    start: vi.fn(),
    startAll: vi.fn(),
  },
}));
vi.mock("../api/albums", () => ({
  albumsApi: {
    setCover: vi.fn(async () => ({})),
  },
}));
vi.mock("../features/wall/PhotoWall", () => ({
  default: ({
    items,
    onOpen,
    onContextMenu,
  }: {
    items: { id: string; kind: string; name: string }[];
    onOpen: (item: unknown, index: number) => void;
    onContextMenu: (
      item: unknown,
      event: React.MouseEvent<HTMLButtonElement>,
    ) => void;
  }) => (
    <div data-testid="photo-wall">
      {items.map((item, index) => (
        <button
          key={item.id}
          onClick={() => onOpen(item, index)}
          onContextMenu={(event) => onContextMenu(item, event)}
        >
          {item.name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../features/viewer/PhotoViewer", () => ({
  default: ({ albumName }: { albumName: string }) => (
    <div data-testid="photo-viewer">大图:{albumName}</div>
  ),
}));

const album = {
  id: "a_trip",
  kind: "album" as const,
  name: "春游",
  displayName: "春游",
  coverImage: "f_cover",
  coverImages: ["f_cover"],
  imageCount: 3,
  videoCount: 1,
  contentKind: "photo" as const,
  // 上级集合：深链打开这一本时，返回要落回它。
  parentId: undefined as string | undefined,
};

function Location() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <output data-testid="location">
      {location.pathname + location.search}|{navigationType}
    </output>
  );
}

function renderPhotoAlbum(node = album, entry = `/albums/${node.id}`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Location />
        <Routes>
          <Route
            path="/albums/:albumId"
            element={<PhotoAlbum album={node} />}
          />
          <Route path="/read/:albumId" element={<div>阅读器</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PhotoAlbum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiJobsApi.list).mockResolvedValue({
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
          gpuEnabled: true,
        },
        modules: [],
      },
    });
    vi.mocked(aiJobsApi.start).mockResolvedValue({
      ok: true,
      reused: false,
      job: { id: "job-scene" },
    } as never);
    vi.mocked(aiJobsApi.startAll).mockResolvedValue({
      ok: true,
      jobs: [],
      skippedModules: [],
    } as never);
    useUIStore.setState({ toasts: [] });
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    });
    vi.mocked(useAlbumMedia).mockReturnValue({
      data: {
        pages: [
          {
            total: 4,
            items: [
              {
                id: "f_1",
                kind: "image",
                index: 0,
                kindIndex: 0,
                name: "1.jpg",
              },
              {
                id: "f_2",
                kind: "image",
                index: 1,
                kindIndex: 1,
                name: "2.jpg",
              },
              {
                id: "f_3",
                kind: "video",
                index: 2,
                kindIndex: 0,
                name: "3.mp4",
              },
            ],
          },
        ],
      },
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      fetchNextPage: vi.fn(),
    } as never);
    vi.mocked(useAlbumFilters).mockReturnValue({
      data: {
        ok: true,
        revision: 1,
        facets: {
          total: 3,
          videos: 1,
          time: {
            available: true,
            months: [{ month: "2024-06", count: 2 }],
            analyzedCount: 2,
            unresolvedCount: 1,
          },
          people: {
            available: true,
            items: [
              { id: "p_1", name: "人物 1", count: 3, confirmed: true },
              { id: "p_2", name: "人物 2", count: 1, confirmed: false },
            ],
            analyzedCount: 4,
          },
          places: {
            available: true,
            items: [
              { adcode: 330100, name: "杭州市", level: "city", count: 2 },
            ],
            locatedCount: 2,
          },
          picks: { pickedCount: 1 },
          groupPhotos: { available: true, count: 0 },
          similarity: {
            available: false,
            reason: "还没有相似照片分析结果",
            groupCount: 0,
            photoCount: 0,
            stale: false,
          },
        },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useSmartAlbumGroups).mockReturnValue({
      data: {
        ok: true,
        summary: {
          albumId: album.id,
          dimension: "time",
          revision: 1,
          snapshotKey: "smart-snapshot",
          totalPhotos: 4,
          availablePhotos: 4,
          unavailablePhotos: 0,
          ungroupedPhotos: 1,
          hiddenGroupCount: 0,
          coverage: {
            module: "metadata",
            total: 4,
            analyzed: 3,
            missing: 1,
            failed: 0,
            withEvidence: 3,
            available: true,
          },
          groups: [
            {
              id: "sg_0123456789abcdef0123",
              dimension: "time",
              name: "2025年6月18日",
              suggestedName: "2025年6月18日",
              customName: false,
              photoCount: 3,
              coverResourceId: "f_1",
              coverVersion: "v1",
              hidden: false,
            },
          ],
          cacheHit: true,
        },
      },
      isLoading: false,
      isError: false,
    } as never);
    vi.mocked(useSmartAlbumGroupMedia).mockReturnValue({
      data: {
        pages: [
          {
            total: 3,
            items: [
              {
                id: "f_smart_1",
                kind: "image",
                index: 0,
                kindIndex: 0,
                name: "group-photo.jpg",
              },
            ],
          },
        ],
      },
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      fetchNextPage: vi.fn(),
      retryNextPage: vi.fn(),
    } as never);
    usePhotoSelectionStore.setState({ active: false, entries: {}, scope: "" });
  });

  it("直接呈现照片墙，没有漫画阅读器的入口", () => {
    renderPhotoAlbum();

    expect(screen.getByTestId("photo-wall")).toBeInTheDocument();
    expect(screen.getByText("春游")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /开始浏览/ })).toBeNull();
    expect(screen.queryByText(/阅读进度/)).toBeNull();
  });

  it("分组是照片的一种看法：开着面板时墙上仍是全部照片，选一组才换", () => {
    renderPhotoAlbum(album, `/albums/${album.id}?dimension=time`);

    // 面板开着，墙上摆的仍是这本相册里的照片 —— 不是另一本相册。
    expect(screen.getByTestId("photo-wall")).toHaveTextContent("1.jpg");
    // 分析口径收在「分析说明」里，默认收起。
    expect(screen.queryByText("分析覆盖 3/4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "分析说明" }));
    expect(screen.getByText("分析覆盖 3/4")).toBeInTheDocument();
    expect(screen.getByText("未分析 1 张")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /^2025年6月18日/ }),
    );

    expect(screen.getByTestId("photo-wall")).toHaveTextContent(
      "group-photo.jpg",
    );
    expect(useSmartAlbumGroupMedia).toHaveBeenLastCalledWith(
      album.id,
      "time",
      "sg_0123456789abcdef0123",
      "smart-snapshot",
    );

    // 恢复入口：回到全部照片。
    fireEvent.click(screen.getByRole("button", { name: "回到全部照片" }));
    expect(screen.getByTestId("photo-wall")).toHaveTextContent("1.jpg");
  });

  // 两套条件不叠加：分组本身就是筛好的结果，筛选条件留在地址栏里
  // 只会让分组视图静默忽略它们。
  it("进入分组时结束冲突的筛选条件，回到全部照片后不再意外恢复", async () => {
    renderPhotoAlbum(
      album,
      `/albums/${album.id}?dimension=time&picks=only`,
    );

    // 分组视图里不摆筛选条：这里没有能再筛的东西。
    fireEvent.click(
      screen.getByRole("button", { name: /^2025年6月18日/ }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/albums/${album.id}?dimension=time&group=sg_0123456789abcdef0123`,
      ),
    );
    expect(screen.queryByRole("button", { name: /^筛选/ })).toBeNull();
    // 地址栏里不再挂着在分组里根本不生效的条件。
    expect(screen.getByTestId("location")).not.toHaveTextContent("picks=only");
    // 界面上说清分组不叠加条件，不让用户自己猜。
    expect(
      screen.getByText(/分组已经是筛好的照片，不叠加其它条件/),
    ).toBeInTheDocument();

    // 回到全部照片：真的回到全部，不再意外恢复那条被结束的筛选。
    fireEvent.click(screen.getByRole("button", { name: "回到全部照片" }));
    await waitFor(() => {
      const last = vi.mocked(useAlbumMedia).mock.calls.at(-1);
      expect(last?.[3]).toEqual({});
    });
  });

  // 分组被重建、删除之后原先选中的那一组已经不在了：退回全部照片。
  // 那是系统的纠错，改地址就行，别往历史里追加失效的地址。
  it("分组失效后自动退回全部照片，不往历史里追加地址", async () => {
    renderPhotoAlbum(
      album,
      `/albums/${album.id}?dimension=time&group=sg_gone`,
    );

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/albums/${album.id}?dimension=time`,
      ),
    );
    expect(screen.getByTestId("location")).not.toHaveTextContent("group=");
    expect(screen.getByTestId("location")).toHaveTextContent("|REPLACE");
  });

  // 分组参数没有维度作伴：它指向一个不存在的看法，删掉。
  it("没有维度的分组参数会被清掉", async () => {
    renderPhotoAlbum(album, `/albums/${album.id}?group=sg_0123456789abcdef0123`);

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/albums/${album.id}|`,
      ),
    );
    expect(screen.getByTestId("location")).not.toHaveTextContent("group=");
  });

  // 分组在服务端已经不存在（被删掉、被换号）：地址里的 id 失效了。
  // 摘要可能还缓存着旧的一份，这时由取媒体的失败把这件事说出来。
  it("分组在服务端已经不存在时退回全部照片", async () => {
    vi.mocked(useSmartAlbumGroupMedia).mockReturnValue({
      data: undefined,
      isError: true,
      error: new ApiError(
        404,
        "分组不存在",
        undefined,
        "smart_group_not_found",
      ),
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      fetchNextPage: vi.fn(),
      retryNextPage: vi.fn(),
    } as never);
    renderPhotoAlbum(
      album,
      `/albums/${album.id}?dimension=time&group=sg_0123456789abcdef0123`,
    );

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/albums/${album.id}?dimension=time`,
      ),
    );
    expect(screen.getByTestId("location")).not.toHaveTextContent("group=");
    expect(screen.getByTestId("location")).toHaveTextContent("|REPLACE");
  });

  // 换一种看法不该把用户勾好的照片弄丢：多选的作用域是这本相册。
  it("分组浏览不清空已经勾选的照片", async () => {
    renderPhotoAlbum(album, `/albums/${album.id}?dimension=time`);

    // 作用域先落在这一本相册上，再勾选。
    await waitFor(() =>
      expect(usePhotoSelectionStore.getState().scope).toBe(
        `album:${album.id}`,
      ),
    );
    act(() => {
      usePhotoSelectionStore.getState().start();
      usePhotoSelectionStore.getState().toggle({
        id: "f_1",
        name: "1.jpg",
        albumId: album.id,
        albumName: "春游",
        kind: "image",
      });
    });
    await waitFor(() =>
      expect(screen.getByText("已选 1 张")).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^2025年6月18日/ }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("group="),
    );

    expect(screen.getByText("已选 1 张")).toBeInTheDocument();
    expect(usePhotoSelectionStore.getState().entries.f_1).toBeTruthy();
  });

  it("场景维度缺少向量时只启动当前相册的语义分析", async () => {    vi.mocked(useSmartAlbumGroups).mockReturnValue({
      data: {
        ok: true,
        summary: {
          albumId: album.id,
          dimension: "scene",
          revision: 1,
          snapshotKey: "scene-snapshot",
          totalPhotos: 4,
          availablePhotos: 4,
          unavailablePhotos: 0,
          ungroupedPhotos: 4,
          hiddenGroupCount: 0,
          coverage: {
            module: "embedding",
            total: 4,
            analyzed: 0,
            missing: 4,
            failed: 0,
            withEvidence: 0,
            available: true,
          },
          groups: [],
          cacheHit: true,
        },
      },
      isLoading: false,
      isError: false,
    } as never);
    renderPhotoAlbum(album, `/albums/${album.id}?view=smart&dimension=scene`);

    fireEvent.click(screen.getByRole("button", { name: "补充语义向量分析" }));

    await waitFor(() =>
      expect(aiJobsApi.start).toHaveBeenCalledWith(
        "embedding",
        "incremental",
        album.id,
      ),
    );
    expect(
      screen.getByRole("button", { name: "已加入分析队列…" }),
    ).toBeDisabled();
  });

  // 分组面板的三种空态：没分析、分析失败、没凑出分组。
  // 每个状态说什么，底下就得给得出对得上的那一个操作。
  it("分组没分析时给的是补分析", () => {
    vi.mocked(useSmartAlbumGroups).mockReturnValue({
      data: {
        ok: true,
        summary: {
          albumId: album.id,
          dimension: "time",
          revision: 1,
          snapshotKey: "time-snapshot",
          totalPhotos: 4,
          availablePhotos: 4,
          unavailablePhotos: 0,
          ungroupedPhotos: 4,
          hiddenGroupCount: 0,
          coverage: {
            module: "metadata",
            total: 4,
            analyzed: 0,
            missing: 4,
            failed: 0,
            withEvidence: 0,
            available: true,
          },
          groups: [],
          cacheHit: true,
        },
      },
      isLoading: false,
      isError: false,
    } as never);
    renderPhotoAlbum(album, `/albums/${album.id}?dimension=time`);

    expect(
      screen.getByRole("heading", { name: "还没有完成分析" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("还有 4 张照片没有完成EXIF 元数据分析。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "补充EXIF 元数据分析" }),
    ).toBeInTheDocument();
  });

  it("分析失败时给的是重新分析", () => {
    vi.mocked(useSmartAlbumGroups).mockReturnValue({
      data: {
        ok: true,
        summary: {
          albumId: album.id,
          dimension: "time",
          revision: 1,
          snapshotKey: "time-snapshot",
          totalPhotos: 4,
          availablePhotos: 4,
          unavailablePhotos: 0,
          ungroupedPhotos: 4,
          hiddenGroupCount: 0,
          coverage: {
            module: "metadata",
            total: 4,
            analyzed: 0,
            missing: 0,
            failed: 4,
            withEvidence: 0,
            available: true,
          },
          groups: [],
          cacheHit: true,
        },
      },
      isLoading: false,
      isError: false,
    } as never);
    renderPhotoAlbum(album, `/albums/${album.id}?dimension=time`);

    expect(
      screen.getByRole("heading", { name: "分析有失败项" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("有 4 张照片分析失败，失败的这些不参与分组。"),
    ).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "重新分析EXIF 元数据" });
    expect(retry).toBeInTheDocument();
    // 失败的照片要重跑，不是补分析。
    expect(
      screen.queryByRole("button", { name: "补充EXIF 元数据分析" }),
    ).toBeNull();
  });

  it("分析做完了却没凑出分组时给的是重建分组", () => {
    vi.mocked(useSmartAlbumGroups).mockReturnValue({
      data: {
        ok: true,
        summary: {
          albumId: album.id,
          dimension: "time",
          revision: 1,
          snapshotKey: "time-snapshot",
          totalPhotos: 4,
          availablePhotos: 4,
          unavailablePhotos: 0,
          ungroupedPhotos: 4,
          hiddenGroupCount: 0,
          coverage: {
            module: "metadata",
            total: 4,
            analyzed: 4,
            missing: 0,
            failed: 0,
            withEvidence: 4,
            available: true,
          },
          groups: [],
          cacheHit: true,
        },
      },
      isLoading: false,
      isError: false,
    } as never);
    renderPhotoAlbum(album, `/albums/${album.id}?dimension=time`);

    expect(
      screen.getByRole("heading", { name: "还没有可展示的分组" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重建分组" }),
    ).toBeInTheDocument();
  });

  it("人物分析未启用时指向每日计划，不启动人脸任务", () => {
    vi.mocked(useSmartAlbumGroups).mockReturnValue({
      data: {
        ok: true,
        summary: {
          albumId: album.id,
          dimension: "people",
          revision: 1,
          snapshotKey: "people-snapshot",
          totalPhotos: 4,
          availablePhotos: 4,
          unavailablePhotos: 0,
          ungroupedPhotos: 4,
          hiddenGroupCount: 0,
          coverage: {
            module: "face",
            total: 4,
            analyzed: 0,
            missing: 4,
            failed: 0,
            withEvidence: 0,
            available: false,
            reason: "people_analysis_disabled",
          },
          groups: [],
          cacheHit: true,
        },
      },
      isLoading: false,
      isError: false,
    } as never);
    renderPhotoAlbum(album, `/albums/${album.id}?dimension=people`);

    // 没有分析结果时不摆误导性的智能操作，只说清为什么用不了。
    expect(screen.getByText(/人物分组依赖人脸分析/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "去任务中心启用" }),
    ).toHaveAttribute("href", "/tasks/plan");
    expect(aiJobsApi.start).not.toHaveBeenCalled();
  });

  it("分组面板默认关着，打开后默认精选推荐，收起就回到全部照片", () => {
    renderPhotoAlbum(album);

    // 默认是原始照片墙：没有分组面板，也没有第二套相册。
    expect(screen.queryByTestId("album-group-list")).toBeNull();
    expect(screen.getByRole("button", { name: "按分组浏览" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "按分组浏览" }));

    expect(screen.getByRole("tab", { name: "精选推荐" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "dimension=recommended",
    );
    // 墙上仍然是这本相册的照片。
    expect(screen.getByTestId("photo-wall")).toHaveTextContent("1.jpg");

    fireEvent.click(screen.getByRole("button", { name: "收起分组浏览" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      `/albums/${album.id}`,
    );
    expect(screen.queryByTestId("album-group-list")).toBeNull();
    expect(screen.getByTestId("photo-wall")).toBeInTheDocument();
  });

  it("支持首页汇总卡片直达对应维度的智能分组", () => {
    const groupId = "sg_0123456789abcdef0123";
    renderPhotoAlbum(
      album,
      `/albums/${album.id}?dimension=time&group=${groupId}`,
    );

    expect(screen.getByTestId("photo-wall")).toHaveTextContent(
      "group-photo.jpg",
    );
    expect(useSmartAlbumGroups).toHaveBeenLastCalledWith(
      album.id,
      "time",
      true,
    );
    expect(useSmartAlbumGroupMedia).toHaveBeenLastCalledWith(
      album.id,
      "time",
      groupId,
      "smart-snapshot",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/albums/${album.id}?dimension=time&group=${groupId}`,
    );
  });

  it("点击照片打开沉浸式大图预览", () => {
    renderPhotoAlbum();

    fireEvent.click(screen.getByText("1.jpg"));

    expect(screen.getByTestId("photo-viewer")).toHaveTextContent("大图:春游");
  });

  it("更多菜单复制相册的完整链接", async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      renderPhotoAlbum();
      fireEvent.click(screen.getByRole("button", { name: "相册更多操作" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "复制相册链接" }));
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          window.location.origin + "/photo/albums/a_trip",
        ),
      );
    } finally {
      if (originalClipboard)
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("照片右键菜单调用已有系统打开动作并恢复焦点", async () => {
    vi.mocked(fsApi.capabilities).mockResolvedValueOnce({ allowOsOpen: true });
    renderPhotoAlbum();
    const image = screen.getByText("1.jpg");
    fireEvent.contextMenu(image);
    const open = screen.getByRole("menuitem", { name: "在文件管理器中打开" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    await waitFor(() =>
      expect(fsApi.openInExplorer).toHaveBeenCalledWith("a_trip"),
    );
    expect(image).toHaveFocus();
  });

  // 内容属性只按目录设置，页面上没有「把这本归类到漫画」的入口。
  it("「更多」菜单没有相册归类入口", () => {
    renderPhotoAlbum();

    fireEvent.click(screen.getByRole("button", { name: "相册更多操作" }));
    expect(screen.queryByRole("menuitem", { name: "移到漫画库" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "移到照片库" })).toBeNull();
  });


  // 智能筛选：条件能组合、逐条能去掉，状态住在地址栏里。
  it("筛选条件写进地址，刷新不丢", async () => {
    renderPhotoAlbum();

    fireEvent.click(screen.getByRole("button", { name: /^筛选/ }));
    fireEvent.click(screen.getByRole("button", { name: /人物 1/ }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("personId=p_1"),
    );
  });

  it("条件能组合，每条都能单独去掉", async () => {
    renderPhotoAlbum();

    fireEvent.click(screen.getByRole("button", { name: /^筛选/ }));
    fireEvent.click(screen.getByRole("button", { name: /人物 1/ }));
    fireEvent.click(screen.getByRole("radio", { name: "已精选" }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("personId=p_1"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("picks=only"),
    );

    // 条件标签逐条摆出来，点掉一条其余留着。
    fireEvent.click(screen.getByTitle("去掉这条条件：人物：人物 1"));
    await waitFor(() =>
      expect(screen.getByTestId("location")).not.toHaveTextContent(
        "personId=p_1",
      ),
    );
    expect(screen.getByTestId("location")).toHaveTextContent("picks=only");
  });

  it("筛选面板只摆这本相册里真实有的选项", () => {
    renderPhotoAlbum();

    fireEvent.click(screen.getByRole("button", { name: /^筛选/ }));

    expect(screen.getByRole("button", { name: /人物 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /杭州市/ })).toBeInTheDocument();
    // 相似照片还没分析：这一档摆出来但点不动，并说清为什么。
    expect(screen.getByRole("radio", { name: "相似照片" })).toBeDisabled();
    expect(screen.getByTitle("还没有相似照片分析结果")).toBeInTheDocument();
  });

  it("缺少分析结果时写明原因，不摆空选项", () => {
    vi.mocked(useAlbumFilters).mockReturnValue({
      data: {
        ok: true,
        revision: 1,
        facets: {
          total: 3,
          videos: 1,
          time: {
            available: false,
            reason: "这本相册还没有 EXIF 分析结果，先在任务中心运行元数据分析",
            months: [],
            analyzedCount: 0,
            unresolvedCount: 0,
          },
          people: { available: true, items: [], analyzedCount: 0 },
          places: { available: true, items: [], locatedCount: 0 },
          picks: { pickedCount: 0 },
          groupPhotos: { available: true, count: 0 },
          similarity: {
            available: false,
            reason: "还没有相似照片分析结果",
            groupCount: 0,
            photoCount: 0,
            stale: false,
          },
        },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    renderPhotoAlbum();

    fireEvent.click(screen.getByRole("button", { name: /^筛选/ }));

    expect(
      screen.getByText(
        "这本相册还没有 EXIF 分析结果，先在任务中心运行元数据分析",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /2024年/ })).toBeNull();
  });

  it("地址栏里带着条件时，进页面就是那套条件", () => {
    renderPhotoAlbum(album, `/albums/${album.id}?picks=only&from=2024-06`);

    fireEvent.click(screen.getByRole("button", { name: /^筛选/ }));
    expect(screen.getByRole("radio", { name: "已精选" })).toBeChecked();
    expect(screen.getByTitle("去掉这条条件：已精选")).toBeInTheDocument();
  });

  it("只在打开筛选面板时启用筛选维度查询", () => {
    renderPhotoAlbum();

    expect(useAlbumFilters).toHaveBeenLastCalledWith(album.id, false);

    fireEvent.click(screen.getByRole("button", { name: /^筛选/ }));

    expect(useAlbumFilters).toHaveBeenLastCalledWith(album.id, true);
  });

  it("筛选维度读取失败时显示重试入口", () => {
    const refetch = vi.fn();
    vi.mocked(useAlbumFilters).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch,
    } as never);
    renderPhotoAlbum();

    fireEvent.click(screen.getByRole("button", { name: /^筛选/ }));

    expect(screen.getByRole("alert")).toHaveTextContent("筛选条件读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("筛选结果为空时可清除筛选，并与本身为空的相册区分", () => {
    vi.mocked(useAlbumMedia).mockReturnValue({
      data: {
        pages: [
          {
            total: 0,
            albumTotal: 7,
            photoTotal: 0,
            videoTotal: 0,
            items: [],
          },
        ],
      },
      hasNextPage: false,
      isLoading: false,
      isError: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    } as never);
    renderPhotoAlbum(album, `/albums/${album.id}?personId=p_1`);

    expect(screen.getByText("0 / 7 张")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "没有符合筛选条件的照片" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(
      screen.getByRole("heading", { name: "相册里还没有媒体" }),
    ).toBeInTheDocument();
  });

  it("改变筛选顺序后仍保留已经选中的条件", async () => {
    renderPhotoAlbum();

    fireEvent.click(screen.getByRole("button", { name: /^筛选/ }));
    fireEvent.click(screen.getByRole("radio", { name: "已精选" }));
    fireEvent.click(screen.getByRole("button", { name: /人物 1/ }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("picks=only"),
    );
    expect(screen.getByTestId("location")).toHaveTextContent("personId=p_1");
  });

  // 深链直接打开一本相册：返回落回它所属的集合，而不是工作台首页。
  it("深链打开相册时返回上级集合", () => {
    renderPhotoAlbum({ ...album, parentId: "c_trip" });

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/photo/albums/c_trip",
    );
  });

  // 没有上级（相册直接挂在媒体根下）：返回落到相册页，那一页按目录
  // 把内容摊开，比回到首页更接近「我刚才在看哪本」。
  it("没有上级时返回落到相册页", () => {
    renderPhotoAlbum();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/photo/library");
  });
});
