import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import PhotoAlbum from "./PhotoAlbum";
import { useAlbumMedia } from "../hooks/useLibrary";
import {
  useSmartAlbumGroupMedia,
  useSmartAlbumGroups,
} from "../hooks/useSmartAlbums";
import { useFavorites } from "../hooks/useFavorites";
import { fsApi } from "../api/fs";
import { useUIStore } from "../store/uiStore";

vi.mock("../hooks/useLibrary", () => ({
  useAlbumMedia: vi.fn(),
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
vi.mock("../api/albums", () => ({
  albumsApi: {
    setCover: vi.fn(async () => ({})),
  },
}));
vi.mock("../components/wall/PhotoWall", () => ({
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
vi.mock("../components/wall/PhotoViewer", () => ({
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
};

function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname + location.search}
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
    } as never);
  });

  it("直接呈现照片墙，没有漫画阅读器的入口", () => {
    renderPhotoAlbum();

    expect(screen.getByTestId("photo-wall")).toBeInTheDocument();
    expect(screen.getByText("春游")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /开始浏览/ })).toBeNull();
    expect(screen.queryByText(/阅读进度/)).toBeNull();
  });

  it("打开智能分组后仍使用相册内的照片墙", () => {
    renderPhotoAlbum();

    fireEvent.click(screen.getByRole("button", { name: "智能相册" }));
    expect(screen.getByText("分析覆盖 3/4")).toBeInTheDocument();
    expect(screen.getByText("未分析 1 张")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "打开分组 2025年6月18日，3 张",
      }),
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
  });

  it("从智能相册直达链接进入分组浏览并可返回原始照片墙", () => {
    renderPhotoAlbum(album, `/albums/${album.id}?view=smart`);

    expect(screen.getByRole("button", { name: "智能相册" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("分析覆盖 3/4")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "原始照片墙" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      `/albums/${album.id}`,
    );
    expect(screen.getByRole("button", { name: "智能相册" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("photo-wall")).toBeInTheDocument();
  });

  it("支持首页汇总卡片直达对应维度的智能分组", () => {
    const groupId = "sg_0123456789abcdef0123";
    renderPhotoAlbum(
      album,
      `/albums/${album.id}?view=smart&dimension=time&group=${groupId}`,
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
      `/albums/${album.id}?view=smart&dimension=time&group=${groupId}`,
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
      fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
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

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.queryByRole("menuitem", { name: "移到漫画库" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "移到照片库" })).toBeNull();
  });

  it("照片墙期间帮助浮层切到照片场景，离开后复位", () => {
    const { unmount } = renderPhotoAlbum();
    expect(useUIStore.getState().helpContext).toBe("photo");
    unmount();
    expect(useUIStore.getState().helpContext).toBe("library");
  });
});
