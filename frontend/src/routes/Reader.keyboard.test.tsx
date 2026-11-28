import {useEffect,type ComponentProps} from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGalleryStore } from "../store/galleryStore";
import { useUIStore } from "../store/uiStore";
import Reader from "./Reader";

const mocks = vi.hoisted(() => ({
  getImage: vi.fn(),
  getVideo: vi.fn(),
  setVideo: vi.fn(),
  keepalive: vi.fn(),
  openInExplorer: vi.fn(),
}));

vi.mock("../api/library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/library")>();
  return {
    ...actual,
    libraryApi: {
      ...actual.libraryApi,
      mediaPage: vi.fn(async () => ({
        ok: true,
        page: {
          revision: 1,
          total: 6,
          items: ["image", "video"].flatMap((kind) =>
            [0, 1, 2].map((index) => ({
              id: `f_${kind}_${index}`,
              kind,
              index,
              kindIndex: index,
              name: `${index}.${kind === "image" ? "png" : "webm"}`,
            })),
          ),
        },
      })),
      queryNodes: vi.fn(async () => ({
        revision: 1,
        missing: [],
        items: [{ id: "a_test", name: "键盘测试", imageCount: 3 }],
      })),
    },
  };
});
vi.mock("../api/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/activity")>()),
  activityApi: { ...mocks, setImage: vi.fn(async () => ({})) },
}));
vi.mock("../api/prefs", () => ({
  historyApi: { add: vi.fn(async () => ({ history: [] })) },
  prefsApi: {
    get: vi.fn(async () => ({
      favorites: [],
      history: [],
      maxRecent: 10,
      autoSwitchAlbum: false,
      showSwitchNotif: false,
      theme: "system",
      sidebarCollapsed: false,
    })),
  },
}));
vi.mock("../hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], toggle: vi.fn() }),
}));
vi.mock("../api/videos", () => ({
  videoUrl: (id: string) => `/api/media/${id}`,
  createVideoPlaybackId: () => "keyboard-test",
  getTranscodeStatus: vi.fn(async () => ({ status: "not_needed" })),
}));
vi.mock("../api/fs", () => ({
  fsApi: {
    openInExplorer: mocks.openInExplorer,
    capabilities: vi.fn(async () => ({ allowOsOpen: true })),
  },
}));
vi.mock("../features/reader/ImageGallery", () => ({
  default: function ObservedGallery({
    albumId = "",
    request,
    onObserve,
    images,
  }: ComponentProps<typeof import("../features/reader/ImageGallery").default>) {
    const index = useGalleryStore((s) => s.index);
    const fileId = images[index];
    useEffect(() => {
      if (request && fileId)
        onObserve?.({
          albumId,
          epoch: request.epoch,
          first: index,
          last: index,
          atTop: index === 0,
          atBottom: index === images.length - 1,
          anchor: {
            albumId,
            fileId,
            index,
            u: 0.5,
            v: 0.5,
            viewportU: 0.5,
            viewportV: 0.5,
          },
        });
    }, [albumId, fileId, index, request, onObserve, images.length]);
    return <div data-testid="image-gallery" />;
  },
}));

function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  );
}

function renderReader(type = "video") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[
          "/comic/albums/a_test",
          `/comic/read/a_test?type=${type}&index=1`,
        ]}
      >
        <Location />
        <Routes>
          <Route path="/comic/read/:albumId" element={<Reader />} />
          <Route path="/comic/albums/a_test" element={<div>相册列表</div>} />
          <Route path="/comic/library" element={<div>书架</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function currentVideo() {
  await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
  const video = document.querySelector("video") as HTMLVideoElement;
  Object.defineProperty(video, "duration", { configurable: true, value: 100 });
  await act(async () => {
    fireEvent.loadedMetadata(video);
  });
  return video;
}

async function pressKey(key: string) {
  await act(async () => {
    fireEvent.keyDown(window, { key });
  });
}

describe("Reader 按媒体类型隔离快捷键", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImage.mockResolvedValue({ pageIndex: 1 });
    mocks.getVideo.mockResolvedValue({ positionMs: 0, durationMs: 100_000 });
    mocks.setVideo.mockResolvedValue({});
    useGalleryStore.setState({
      index: 0,
      zoom: 1,
      rotation: 0,
      slideshow: false,
      mode: "single",
      fit: "fit",
      direction: "ltr",
    });
  });

  it("视频左右键只定位当前文件，不同时切换到另一个视频", async () => {
    renderReader();
    const video = await currentVideo();
    video.currentTime = 20;
    await pressKey("ArrowRight");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "type=video&index=1",
    );
    expect(video.currentTime).toBe(25);
    expect(document.querySelector("video")).toBe(video);
    await pressKey("ArrowLeft");
    expect(video.currentTime).toBe(20);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "type=video&index=1",
    );
  });

  it("视频空格仅切换播放，图片专属按键不修改图片偏好", async () => {
    renderReader();
    const video = await currentVideo();
    const play = vi.spyOn(video, "play").mockResolvedValue();
    await pressKey(" ");
    expect(play).toHaveBeenCalledOnce();
    expect(useGalleryStore.getState().slideshow).toBe(false);
    for (const key of ["1", "2", "3", "f", "l", "r", "+", "-", "0", "i"]) {
      const before = useGalleryStore.getState();
      await pressKey(key);
      expect(useGalleryStore.getState()).toBe(before);
    }
  });

  it("视频 PageUp/PageDown 与首尾定位独立于图片显示模式", async () => {
    useGalleryStore.setState({ mode: "continuous" });
    renderReader();
    await currentVideo();
    for (const [key, index] of [
      ["PageDown", 2],
      ["PageUp", 1],
      ["Home", 0],
      ["End", 2],
    ] as const) {
      await pressKey(key);
      expect(screen.getByTestId("location")).toHaveTextContent(
        `type=video&index=${index}`,
      );
    }
  });

  // 漫画侧的兜底是书架而不是相册页：漫画相册页会重定向回阅读器
  // （卷就是从那儿进来的，还不带走页码），把「返回」送回相册页等于
  // 让人原地打转。
  it("视频 Esc 退回书架，不受空图片列表阻挡", async () => {
    renderReader();
    await currentVideo();
    await pressKey("Escape");
    expect(screen.getByTestId("location")).toHaveTextContent("/comic/library");
    expect(screen.getByText("书架")).toBeInTheDocument();
  });

  it("视频计数不沿用图片双页显示，并提示独立的换片按键", async () => {
    useGalleryStore.setState({ mode: "double" });
    renderReader();
    await currentVideo();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "2 / 3",
    );
    expect(screen.getByTitle("上一个视频 (PageUp)")).toBeInTheDocument();
    expect(screen.getByTitle("下一个视频 (PageDown)")).toBeInTheDocument();
  });

  it("打开目录后数字与翻页快捷键不改变背景", async () => {
    renderReader("image");
    await screen.findByTestId("image-gallery");
    await pressKey("t");
    const dialog = await screen.findByRole("dialog", { name: "目录" });
    const before = useGalleryStore.getState().index;
    fireEvent.keyDown(dialog, { key: "3" });
    await pressKey("PageDown");
    expect(useGalleryStore.getState().mode).toBe("single");
    expect(useGalleryStore.getState().index).toBe(before);
    fireEvent.keyDown(dialog, { key: "t" });
    expect(screen.queryByRole("dialog", { name: "目录" })).toBeNull();
  });

  it("图片模式左右翻页与空格前进", async () => {
    renderReader("image");
    await screen.findByTestId("image-gallery");
    await waitFor(() => expect(useGalleryStore.getState().index).toBe(1));
    await pressKey("ArrowRight");
    expect(useGalleryStore.getState().index).toBe(2);
    await pressKey("ArrowLeft");
    expect(useGalleryStore.getState().index).toBe(1);
    await pressKey(" ");
    expect(useGalleryStore.getState().index).toBe(2);
    expect(useGalleryStore.getState().slideshow).toBe(false);
  });

  it("视频播到末尾的提示用视频的说法，并说明相册里还有图片", async () => {
    useUIStore.setState({ toasts: [] });
    renderReader("video");
    await currentVideo();
    await pressKey("End");
    await pressKey("PageDown");
    expect(useUIStore.getState().toasts.at(-1)?.message).toBe(
      "已是最后一个视频 · 相册里另有 3 页图片",
    );
  });

  it("图片播到末尾的提示说明相册里还有视频", async () => {
    useUIStore.setState({ toasts: [] });
    renderReader("image");
    await screen.findByTestId("image-gallery");
    await waitFor(() => expect(useGalleryStore.getState().index).toBe(1));
    await pressKey("End");
    await pressKey("ArrowRight");
    expect(await screen.findByText("图片已看完 · 还有 3 个视频")).toBeVisible();
  });

  it("视频阅读器的更多菜单不说图片，也不提供没有实现的图片信息", async () => {
    renderReader("video");
    await currentVideo();
    await act(async () => {
      fireEvent.click(screen.getByTitle("更多"));
    });
    const items = screen
      .getAllByRole("menuitem")
      .map((el) => el.textContent ?? "")
      .join("|");
    expect(items).toContain("第一个视频");
    expect(items).toContain("最后一个视频");
    expect(items).not.toContain("图片");
  });

  it("图片阅读器的更多菜单保留图片信息与页数说法", async () => {
    renderReader("image");
    await screen.findByTestId("image-gallery");
    await act(async () => {
      fireEvent.click(screen.getByTitle("更多"));
    });
    const items = screen
      .getAllByRole("menuitem")
      .map((el) => el.textContent ?? "")
      .join("|");
    expect(items).toContain("图片信息");
    expect(items).toContain("第一页");
    expect(items).toContain("最后一页");
  });

  it("阅读器右键菜单可以在系统文件管理器中定位当前文件", async () => {
    mocks.openInExplorer.mockResolvedValue({ ok: true });
    renderReader("image");
    await screen.findByTestId("image-gallery");
    await waitFor(() => expect(useGalleryStore.getState().index).toBe(1));
    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId("gallery-reader"));
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "在文件管理器中打开" }),
      );
    });
    expect(mocks.openInExplorer).toHaveBeenCalledWith("f_image_1");
  });
});
