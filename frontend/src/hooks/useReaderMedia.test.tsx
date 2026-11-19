import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { libraryApi } from "../api/library";
import { useAlbumMedia } from "./useLibrary";
import { useReaderMedia } from "./useReaderMedia";

vi.mock("./useAppMode", () => ({ useAppMode: () => ({ ready: true }) }));
vi.mock("../api/library", async (original) => {
  const actual = await original<typeof import("../api/library")>();
  return {
    ...actual,
    libraryApi: { ...actual.libraryApi, mediaPage: vi.fn() },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

function media(id: string, kind: "image" | "video" = "image") {
  return {
    id,
    kind,
    name: `${id}.jpg`,
    index: 0,
    kindIndex: 0,
  };
}

function page(items: ReturnType<typeof media>[], nextCursor?: string) {
  return {
    ok: true,
    page: {
      revision: 1,
      total: items.length,
      items,
      nextCursor,
      // 相册照片墙的附加信息：没筛选时这些数就是这本相册本身。
      filtered: false,
      albumTotal: items.length,
      videoTotal: items.filter((item) => item.kind === "video").length,
      photoTotal: items.filter((item) => item.kind === "image").length,
      unresolved: { captureTime: 0, location: 0, face: 0, total: 0 },
      grouped: 0,
      groupedGroups: 0,
    },
  };
}

function setup(albumId: string, isVideo = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    ({ id, video }: { id: string; video: boolean }) =>
      useReaderMedia(id, video),
    { wrapper, initialProps: { id: albumId, video: isVideo } },
  );
  return { ...view, client };
}

it("整本清单取完才算就绪", async () => {
  vi.mocked(libraryApi.mediaPage)
    .mockResolvedValueOnce(page([media("f1"), media("f2")], "next"))
    .mockResolvedValueOnce(page([media("f3")]));
  const { result } = setup("a_1");
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.images).toEqual(["f1", "f2", "f3"]);
  expect(libraryApi.mediaPage).toHaveBeenCalledTimes(2);
});

it("还有页没取到时不算就绪", async () => {
  let release!: (value: ReturnType<typeof page>) => void;
  vi.mocked(libraryApi.mediaPage)
    .mockResolvedValueOnce(page([media("f1")], "next"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
  const { result } = setup("a_1");
  await waitFor(() => expect(result.current.images).toEqual(["f1"]));
  expect(result.current.status).toBe("loading");
  await act(async () => {
    release(page([media("f2")]));
  });
  await waitFor(() => expect(result.current.status).toBe("ready"));
});

it("相册里没有当前类型的媒体时是空态", async () => {
  vi.mocked(libraryApi.mediaPage).mockResolvedValue(
    page([media("v1", "video")]),
  );
  const { result } = setup("a_1", false);
  await waitFor(() => expect(result.current.status).toBe("empty"));
  expect(result.current.siblingCount).toBe(1);
});

it("取不到清单时报失败并给出中文提示", async () => {
  vi.mocked(libraryApi.mediaPage).mockRejectedValue(new Error("offline"));
  const { result } = setup("a_1");
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.error).toBe("无法读取媒体（网络或服务异常）");
});

it("与相册页共用同一份缓存，不重复下载", async () => {
  vi.mocked(libraryApi.mediaPage).mockResolvedValue(page([media("f1")]));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  renderHook(() => useAlbumMedia("a_1"), { wrapper });
  const { result } = renderHook(() => useReaderMedia("a_1", false), { wrapper });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(libraryApi.mediaPage).toHaveBeenCalledTimes(1);
});
