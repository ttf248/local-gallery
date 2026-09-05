import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUnreadAlbums } from "./useUnreadAlbums";
import { useFavorites } from "./useFavorites";

// 这些 hook 同时被 useUnreadAlbums 使用,所以 mock 掉,避免触发网络。
vi.mock("./useFavorites", () => ({
  useFavorites: vi.fn(),
}));
vi.mock("./useImageActivity", () => ({
  useImageActivities: vi.fn(),
}));
vi.mock("./useLibrary", () => ({
  useLibraryAlbums: vi.fn(),
}));

import { useImageActivities } from "./useImageActivity";
import { useLibraryAlbums } from "./useLibrary";

const baseAlbum = (id: string, name: string, imageCount = 10) => ({
  id,
  kind: "album" as const,
  name,
  displayName: name,
  imageCount,
  videoCount: 0,
  mediaCount: imageCount,
  coverImage: id + "-cover",
  coverImages: [id + "-cover"],
  folderSize: 0,
  tags: [] as string[],
  modTime: "",
});

function seedLibrary(albums: ReturnType<typeof baseAlbum>[]) {
  vi.mocked(useLibraryAlbums).mockReturnValue({
    data: { revision: 1, items: albums, total: albums.length },
    isLoading: false,
  } as never);
}

describe("useUnreadAlbums", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLibraryAlbums).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as never);
  });

  it("没有 progress 的相册视为未读", () => {
    seedLibrary([baseAlbum("/a", "A"), baseAlbum("/b", "B")]);
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    });
    vi.mocked(useImageActivities).mockReturnValue({
      data: {},
      isLoading: false,
    } as never);

    const { result } = renderHook(() => useUnreadAlbums());
    expect(result.current.count).toBe(2);
    expect(result.current.cards.map((c) => c.title)).toEqual(["A", "B"]);
  });

  it("progress.index > 0 视为已开始,不算未读", () => {
    seedLibrary([baseAlbum("/a", "A"), baseAlbum("/b", "B")]);
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    });
    vi.mocked(useImageActivities).mockReturnValue({
      data: {
        "/a": {
          albumId: "/a",
          mediaKind: "image",
          pageIndex: 3,
          pageCount: 10,
          status: "in_progress",
          updated: "",
        },
      },
      isLoading: false,
    } as never);

    const { result } = renderHook(() => useUnreadAlbums());
    expect(result.current.count).toBe(1);
    expect(result.current.cards.map((c) => c.title)).toEqual(["B"]);
  });

  it("已保存的 progress.index === 0 视为在读而非未读", () => {
    seedLibrary([baseAlbum("/a", "A")]);
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    });
    vi.mocked(useImageActivities).mockReturnValue({
      data: {
        "/a": {
          albumId: "/a",
          mediaKind: "image",
          pageIndex: 0,
          pageCount: 10,
          status: "in_progress",
          updated: "",
        },
      },
      isLoading: false,
    } as never);

    const { result } = renderHook(() => useUnreadAlbums());
    expect(result.current.count).toBe(0);
  });

  it("progress.total === 0 视为未读(老格式进度数据)", () => {
    seedLibrary([baseAlbum("/a", "A")]);
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    });
    vi.mocked(useImageActivities).mockReturnValue({
      data: {
        "/a": {
          albumId: "/a",
          mediaKind: "image",
          pageIndex: 5,
          pageCount: 0,
          status: "in_progress",
          updated: "",
        },
      },
      isLoading: false,
    } as never);

    const { result } = renderHook(() => useUnreadAlbums());
    expect(result.current.count).toBe(1);
  });

  it("total 反映全库总数,不是未读数", () => {
    seedLibrary([
      baseAlbum("/a", "A"),
      baseAlbum("/b", "B"),
      baseAlbum("/c", "C"),
    ]);
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    });
    vi.mocked(useImageActivities).mockReturnValue({
      data: {
        "/a": {
          albumId: "/a",
          mediaKind: "image",
          pageIndex: 3,
          pageCount: 10,
          status: "in_progress",
          updated: "",
        },
      },
      isLoading: false,
    } as never);

    const { result } = renderHook(() => useUnreadAlbums());
    expect(result.current.count).toBe(2); // 未读
    expect(result.current.total).toBe(3); // 全库
  });

  it("isFavorite 从 favorites Set 派生", () => {
    seedLibrary([baseAlbum("/a", "A"), baseAlbum("/b", "B")]);
    vi.mocked(useFavorites).mockReturnValue({
      favorites: ["/b"],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    });
    vi.mocked(useImageActivities).mockReturnValue({
      data: {},
      isLoading: false,
    } as never);

    const { result } = renderHook(() => useUnreadAlbums());
    const byTitle = Object.fromEntries(
      result.current.cards.map((c) => [c.title, c.isFavorite]),
    );
    expect(byTitle["A"]).toBeFalsy();
    expect(byTitle["B"]).toBe(true);
  });

  it("可复用调用方的进度快照且不重复查询", () => {
    seedLibrary([baseAlbum("/a", "A"), baseAlbum("/b", "B")]);
    vi.mocked(useFavorites).mockReturnValue({
      favorites: [],
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    });
    vi.mocked(useImageActivities).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as never);

    const { result } = renderHook(() =>
      useUnreadAlbums({
        progressMap: {
          "/a": {
            albumId: "/a",
            mediaKind: "image",
            pageIndex: 3,
            pageCount: 10,
            status: "in_progress",
            updated: "",
          },
        },
        loadProgress: false,
      }),
    );

    expect(useImageActivities).toHaveBeenCalledWith(["/a", "/b"], false);
    expect(result.current.cards.map((card) => card.title)).toEqual(["B"]);
  });
});
