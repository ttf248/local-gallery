import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGalleryStore } from "../store/galleryStore";
import Reader from "./Reader";

const mocks = vi.hoisted(() => ({
  media: vi.fn(),
  nodes: vi.fn(),
  getImage: vi.fn(),
  setImage: vi.fn(),
  keepalive: vi.fn(),
  historyAdd: vi.fn(),
}));

vi.mock("../api/library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/library")>();
  return {
    ...actual,
    libraryApi: {
      ...actual.libraryApi,
      mediaPage: async (...args: unknown[]) => ({
        ok: true,
        page: await mocks.media(...args),
      }),
      queryNodes: mocks.nodes,
      childrenAll: vi.fn(async () => []),
    },
  };
});

vi.mock("../api/activity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/activity")>();
  return {
    ...actual,
    activityApi: {
      getImage: mocks.getImage,
      setImage: mocks.setImage,
      keepalive: mocks.keepalive,
    },
  };
});

vi.mock("../api/prefs", () => ({
  historyApi: { add: mocks.historyAdd },
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

vi.mock("../hooks/useKeyboard", () => ({ useKeyboard: vi.fn() }));
vi.mock("../hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], toggle: vi.fn() }),
}));
vi.mock("../utils/fullscreen", () => ({ toggleFullscreen: vi.fn() }));
vi.mock("../features/reader/ImageGallery", () => ({
  default: () => <div data-testid="image-gallery" />,
}));
vi.mock("../features/viewer/VideoPlayer", () => ({
  default: () => <div data-testid="video-player" />,
}));
vi.mock("../features/reader/PageSlider", () => ({
  default: () => null,
}));
vi.mock("../features/reader/GalleryHeader", () => ({
  default: ({ name }: { name: string }) => <h1>{name}</h1>,
}));
vi.mock("../features/reader/GalleryAlbumNav", () => ({
  default: () => null,
}));
vi.mock("../features/reader/GalleryToolbar", () => ({
  default: () => null,
}));
vi.mock("../features/viewer/ImageInfoPanel", () => ({
  default: () => null,
}));
vi.mock("../features/common/HelpOverlay", () => ({
  default: () => null,
}));

const albumId = "a_0000000000000000000001";

function renderReader(query = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Providers(_props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/read/${albumId}${query}`]}>
          <Routes>
            <Route path="/read/:albumId" element={<Reader />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<Reader />, { wrapper: Providers });
}

function writeContext(list: { key: string; name: string }[]) {
  sessionStorage.setItem(
    "local-gallery-context",
    JSON.stringify({
      source: { type: "collection", parentPath: "" },
      list: list.map((item) => ({
        key: item.key,
        to: `/comic/albums/${item.key}`,
        name: item.name,
        kind: "album",
        imageCount: 3,
        videoCount: 0,
        contentKind: "comic",
      })),
      index: 0,
      openedAt: Date.now(),
    }),
  );
}

describe("读到末页的收尾界面", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.setImage.mockResolvedValue({});
    mocks.keepalive.mockResolvedValue({});
    mocks.historyAdd.mockResolvedValue({ history: [] });
    mocks.nodes.mockResolvedValue({
      revision: 1,
      missing: [],
      items: [
        {
          id: albumId,
          kind: "album",
          contentKind: "comic",
          name: "第01话",
          displayName: "第01话",
          parentName: "星海镖师",
          coverImages: [],
          imageCount: 3,
        },
      ],
    });
    mocks.media.mockResolvedValue({
      revision: 1,
      total: 3,
      items: ["f_1", "f_2", "f_3"].map((id, index) => ({
        id,
        kind: "image",
        name: `${index}.jpg`,
        index,
        kindIndex: index,
      })),
    });
    // 没有读过的记录：404 表示这一卷还没翻开过。
    mocks.getImage.mockRejectedValue(new Error("not found"));
    useGalleryStore.setState({ index: -1, mode: "single" });
  });

  it("读到末页时给出收尾界面", async () => {
    renderReader("?index=2");
    await waitFor(() =>
      expect(screen.getByTestId("reader-finished")).toBeInTheDocument(),
    );
  });

  it("没有下一卷时收尾界面说清楚，并不再摆那个走不通的按钮", async () => {
    renderReader("?index=2");
    await waitFor(() =>
      expect(screen.getByTestId("reader-finished")).toBeInTheDocument(),
    );
    expect(screen.getByText("这一部读完了")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "下一卷" }),
    ).not.toBeInTheDocument();
  });

  it("有下一卷时收尾界面留着「下一卷」", async () => {
    writeContext([
      { key: albumId, name: "第01话" },
      { key: "a_next", name: "第02话" },
    ]);
    renderReader("?index=2");
    await waitFor(() =>
      expect(screen.getByTestId("reader-finished")).toBeInTheDocument(),
    );
    expect(screen.getByText("这卷读完了")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一卷" })).toBeInTheDocument();
  });

  it("恢复到末页时不弹收尾界面", async () => {
    mocks.getImage.mockResolvedValue({ pageIndex: 2, pageCount: 3 });
    renderReader();
    await waitFor(() => expect(mocks.getImage).toHaveBeenCalled());
    // 恢复完成后稍等一拍，确认没有弹出收尾提示。
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByTestId("reader-finished")).not.toBeInTheDocument();
  });
});
