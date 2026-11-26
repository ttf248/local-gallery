import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { useGalleryStore } from "../store/galleryStore";
import Reader from "./Reader";

/**
 * 阅读器的返回目标。
 *
 * 漫画卷的相册地址会重定向回阅读器：深链打开阅读器时若回落到那一卷的
 * 相册地址，按返回会原地打转。回落必须是能确认的上级（所属作品）。
 */

const mocks = vi.hoisted(() => ({
  media: vi.fn(),
  nodes: vi.fn(),
  getImage: vi.fn(),
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
    },
  };
});

vi.mock("../api/activity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/activity")>();
  return {
    ...actual,
    activityApi: {
      ...actual.activityApi,
      getImage: mocks.getImage,
      setImage: vi.fn(async () => ({})),
      keepalive: vi.fn(async () => ({})),
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
vi.mock("../features/reader/PageSlider", () => ({ default: () => null }));
// 顶栏换成带返回按钮的假件：这里要验的是返回落到哪里。
vi.mock("../features/reader/GalleryHeader", () => ({
  default: ({ name, onBack }: { name: string; onBack: () => void }) => (
    <div>
      <h1>{name}</h1>
      <button type="button" onClick={onBack}>
        返回
      </button>
    </div>
  ),
}));
vi.mock("../features/reader/GalleryAlbumNav", () => ({ default: () => null }));
vi.mock("../features/reader/GalleryToolbar", () => ({ default: () => null }));
vi.mock("../features/viewer/ImageInfoPanel", () => ({ default: () => null }));
vi.mock("../features/common/HelpOverlay", () => ({ default: () => null }));

const albumId = "a_0000000000000000000001";

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderReader() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Providers(_props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/read/${albumId}`]}>
          <Location />
          <Routes>
            <Route path="/read/:albumId" element={<Reader />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  render(<Reader />, { wrapper: Providers });
}

function seedVolume(parentId?: string) {
  mocks.nodes.mockResolvedValue({
    revision: 1,
    missing: [],
    items: [
      {
        id: albumId,
        kind: "album",
        contentKind: "comic",
        name: "第1卷",
        displayName: "第1卷",
        parentName: "星海漫步",
        parentId,
        coverImages: [],
        imageCount: 3,
      },
    ],
  });
  mocks.media.mockResolvedValue({
    revision: 1,
    items: ["f_1", "f_2", "f_3"].map((id, index) => ({
      id,
      kind: "image",
      name: `${index}.jpg`,
      index,
      kindIndex: index,
    })),
    total: 3,
  });
  mocks.getImage.mockResolvedValue({ pageIndex: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.historyAdd.mockResolvedValue({ history: [] });
  useGalleryStore.setState({ index: -1, mode: "single" });
});

it("深链打开阅读器时返回所属作品", async () => {
  seedVolume("c_work");
  renderReader();

  // 等摘要回来（顶栏写上作品名即说明摘要已到），再点返回。
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "星海漫步 · 第1卷",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  expect(screen.getByTestId("location")).toHaveTextContent(
    "/comic/albums/c_work",
  );
});

it("不知道所属作品时返回书架", async () => {
  seedVolume();
  renderReader();

  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "第1卷",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  expect(screen.getByTestId("location")).toHaveTextContent("/comic/library");
});

/**
 * 照片侧的阅读器放的是这一本相册的内容，来路就是它自己的照片墙。
 * 回到上级集合会跳过这一本 —— 用户刚在看这一本，退出却到了它的父亲。
 */
it("照片侧的阅读器回到这一本自己的相册页", async () => {
  mocks.nodes.mockResolvedValue({
    revision: 1,
    missing: [],
    items: [
      {
        id: albumId,
        kind: "album",
        contentKind: "photo",
        name: "春游",
        displayName: "春游",
        parentId: "c_trip",
        coverImages: [],
        imageCount: 3,
      },
    ],
  });
  mocks.media.mockResolvedValue({
    revision: 1,
    items: ["f_1", "f_2", "f_3"].map((id, index) => ({
      id,
      kind: "image",
      name: `${index}.jpg`,
      index,
      kindIndex: index,
    })),
    total: 3,
  });
  mocks.getImage.mockResolvedValue({ pageIndex: 0 });

  renderReader();

  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("春游"),
  );
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/photo/albums/${albumId}`,
  );
});
