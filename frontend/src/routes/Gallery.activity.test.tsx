import type { ReactNode } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { activityApi } from "../api/activity";
import { libraryApi } from "../api/library";
import { useGalleryStore } from "../store/galleryStore";
import Gallery from "./Gallery";

interface MockVideoProps {
  initialPositionSec?: number;
  onMetaLoaded?: (durationSec: number) => void;
  onProgress?: (currentTimeSec: number) => void;
}

const mocks = vi.hoisted(() => ({
  media: vi.fn(),
  nodes: vi.fn(),
  getImage: vi.fn(),
  getVideo: vi.fn(),
  setImage: vi.fn(),
  setVideo: vi.fn(),
  keepalive: vi.fn(),
  historyAdd: vi.fn(),
  videoProps: null as unknown,
}));

vi.mock("../api/library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/library")>();
  return {
    ...actual,
    libraryApi: {
      ...actual.libraryApi,
      allMedia: mocks.media,
      queryNodes: mocks.nodes,
    },
  };
});

vi.mock("../api/activity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/activity")>();
  return {
    ...actual,
    activityApi: {
      getImage: mocks.getImage,
      getVideo: mocks.getVideo,
      setImage: mocks.setImage,
      setVideo: mocks.setVideo,
      keepalive: mocks.keepalive,
    },
  };
});

vi.mock("../api/prefs", () => ({
  historyApi: { add: mocks.historyAdd },
}));

vi.mock("../hooks/useKeyboard", () => ({ useKeyboard: vi.fn() }));
vi.mock("../hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], toggle: vi.fn() }),
}));
vi.mock("../utils/fullscreen", () => ({ toggleFullscreen: vi.fn() }));
vi.mock("../components/gallery/ImageGallery", () => ({
  default: () => <div data-testid="image-gallery" />,
}));
vi.mock("../components/gallery/VideoPlayer", () => ({
  default: (props: MockVideoProps) => {
    mocks.videoProps = props;
    return <div data-testid="video-player" />;
  },
}));
vi.mock("../components/gallery/PageSlider", () => ({
  default: () => null,
}));
vi.mock("../components/gallery/GalleryHeader", () => ({
  default: () => null,
}));
vi.mock("../components/gallery/GalleryControls", () => ({
  default: () => null,
}));
vi.mock("../components/gallery/ImageInfoPanel", () => ({
  default: () => null,
}));
vi.mock("../components/common/HelpOverlay", () => ({
  default: () => null,
}));

const albumId = "a_0000000000000000000001";
const videoId = "f_0000000000000000000001";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderGallery(query = `path=${albumId}`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/gallery?${query}`]}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<Gallery />, { wrapper: Providers });
}

describe("Gallery 媒体活动恢复门禁", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.videoProps = null;
    mocks.setImage.mockResolvedValue({});
    mocks.setVideo.mockResolvedValue({});
    mocks.historyAdd.mockResolvedValue({});
    mocks.nodes.mockResolvedValue({
      revision: 1,
      items: [],
      missing: [albumId],
    });
    useGalleryStore.setState({ index: -1, mode: "single" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("图片恢复查询超过防抖窗口时不会先用初始页覆盖记录", async () => {
    const lookup = deferred<{
      albumId: string;
      mediaKind: "image";
      pageIndex: number;
      pageCount: number;
      status: "in_progress";
      updated: string;
    }>();
    mocks.media.mockResolvedValue({
      revision: 1,
      items: ["f_1", "f_2", "f_3", "f_4"].map((id, index) => ({
        id,
        kind: "image",
        name: `${index}.jpg`,
        index,
        kindIndex: index,
      })),
      total: 4,
    });
    mocks.getImage.mockReturnValue(lookup.promise);

    renderGallery();
    await waitFor(() => expect(activityApi.getImage).toHaveBeenCalled());
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    expect(activityApi.setImage).not.toHaveBeenCalled();

    await act(async () => {
      lookup.resolve({
        albumId,
        mediaKind: "image",
        pageIndex: 1,
        pageCount: 4,
        status: "in_progress",
        updated: "2026-09-05T00:00:00Z",
      });
      await lookup.promise;
    });
    await waitFor(() => expect(useGalleryStore.getState().index).toBe(1));
    expect(activityApi.setImage).not.toHaveBeenCalled();
    await waitFor(
      () => expect(activityApi.setImage).toHaveBeenCalledWith(albumId, 1, 4),
      { timeout: 1_000 },
    );
  });

  it("活动查询失败时快速离开不会写入初始图片位置", async () => {
    const lookup = deferred<never>();
    mocks.media.mockResolvedValue({
      revision: 1,
      items: ["f_1", "f_2"].map((id, index) => ({
        id,
        kind: "image",
        name: `${index}.jpg`,
        index,
        kindIndex: index,
      })),
      total: 2,
    });
    mocks.getImage.mockReturnValue(lookup.promise);

    const view = renderGallery();
    await waitFor(() =>
      expect(libraryApi.allMedia).toHaveBeenCalledWith(albumId),
    );
    await waitFor(() => expect(activityApi.getImage).toHaveBeenCalled());
    view.unmount();

    expect(activityApi.setImage).not.toHaveBeenCalled();
    expect(activityApi.keepalive).not.toHaveBeenCalled();
    lookup.reject(
      new ApiError(500, "unavailable", undefined, "activity_unavailable"),
    );
  });

  it("视频查询完成前不保存自动播放位置，快速离开也不写零值", async () => {
    const lookup = deferred<never>();
    mocks.media.mockResolvedValue({
      revision: 1,
      items: [
        {
          id: videoId,
          kind: "video",
          name: "video.mp4",
          index: 0,
          kindIndex: 0,
        },
      ],
      total: 1,
    });
    mocks.getVideo.mockReturnValue(lookup.promise);

    const view = renderGallery(`path=${albumId}&type=video&index=0`);
    await waitFor(() => expect(activityApi.getVideo).toHaveBeenCalled());
    const props = mocks.videoProps as MockVideoProps;
    act(() => {
      props.onMetaLoaded?.(100);
      props.onProgress?.(1);
    });
    expect(activityApi.setVideo).not.toHaveBeenCalled();

    view.unmount();
    expect(activityApi.keepalive).not.toHaveBeenCalled();
    lookup.reject(
      new ApiError(500, "unavailable", undefined, "activity_unavailable"),
    );
  });

  it("视频恢复完成后才开放节流写入", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const lookup = deferred<{
      albumId: string;
      mediaKind: "video";
      itemId: string;
      positionMs: number;
      durationMs: number;
      status: "in_progress";
      updated: string;
    }>();
    mocks.media.mockResolvedValue({
      revision: 1,
      items: [
        {
          id: videoId,
          kind: "video",
          name: "video.mp4",
          index: 0,
          kindIndex: 0,
        },
      ],
      total: 1,
    });
    mocks.getVideo.mockReturnValue(lookup.promise);

    renderGallery(`path=${albumId}&type=video&index=0`);
    await waitFor(() => expect(activityApi.getVideo).toHaveBeenCalled());
    act(() => {
      (mocks.videoProps as MockVideoProps).onMetaLoaded?.(100);
    });
    await act(async () => {
      lookup.resolve({
        albumId,
        mediaKind: "video",
        itemId: videoId,
        positionMs: 42_000,
        durationMs: 100_000,
        status: "in_progress",
        updated: "2026-09-05T00:00:00Z",
      });
      await lookup.promise;
    });
    await waitFor(() =>
      expect((mocks.videoProps as MockVideoProps).initialPositionSec).toBe(42),
    );

    now += 10_001;
    act(() => {
      (mocks.videoProps as MockVideoProps).onProgress?.(43);
    });
    expect(activityApi.setVideo).toHaveBeenCalledWith(
      albumId,
      videoId,
      43_000,
      100_000,
    );
  });
});
