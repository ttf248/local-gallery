import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SmartAlbums from "./SmartAlbums";
import type { SmartAlbumDirectoryDimension } from "../api/albums";
import { useAppModeStore } from "../store/appModeStore";

const requests: {
  dimension: SmartAlbumDirectoryDimension;
  cursor?: string;
  limit?: number;
}[] = [];

vi.mock("../api/albums", async (original) => ({
  ...(await original<typeof import("../api/albums")>()),
  albumsApi: {
    smartDirectory: (
      dimension: SmartAlbumDirectoryDimension,
      options: { cursor?: string; limit?: number } = {},
    ) => {
      requests.push({
        dimension,
        cursor: options.cursor,
        limit: options.limit,
      });
      const page = options.cursor ? 2 : 1;
      return Promise.resolve({
        ok: true,
        page: {
          revision: 1,
          total: 4,
          nextCursor: page === 1 ? "cursor-2" : "",
          items: [
            {
              albumId: "a_1",
              albumName: "2023年测试相册",
              parentName: "家庭照片",
              group: {
                id: `sg_0123456789abcdef012${page}`,
                dimension,
                name: page === 1 ? "2024年春游" : "2024年夏游",
                suggestedName: "2024年春游",
                customName: false,
                photoCount: 3,
                coverResourceId: "f_cover",
                coverVersion: "v1",
                coverWidth: 1600,
                coverHeight: 900,
                hidden: false,
                qualityScore: 0.84,
                evidenceDimensions: ["time", "place", "scene"],
                recommendationReasons: ["连续拍摄时间", "同一地点", "相近场景"],
              },
            },
          ],
        },
      });
    },
  },
}));

// 瀑布流按容器宽度排布：测试里给一个固定宽度。
vi.mock("../hooks/useElementSize", () => ({
  useElementSize: () => ({
    ref: () => {},
    width: 1200,
    height: 800,
    element: null,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.search}</span>;
}

/** 目录请求：页签上的计数是 limit=1 的轻量请求，不算在内。 */
function directoryRequests() {
  return requests.filter((request) => request.limit !== 1);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/photo/smart-albums"]}>
        <SmartAlbums />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("智能相册专页", () => {
  beforeEach(() => {
    requests.length = 0;
    useAppModeStore.setState({ preference: "photo", hydrated: true });
  });

  it("默认精选推荐并按来源相册展示证据", async () => {
    renderPage();
    await waitFor(() => expect(directoryRequests().length).toBe(1));

    expect(screen.getByRole("tab", { name: /精选推荐/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const link = await screen.findByRole("link", {
      name: /打开智能相册 2024年春游/,
    });
    expect(link).toHaveAttribute(
      "href",
      "/photo/albums/a_1?view=smart&dimension=recommended&group=sg_0123456789abcdef0121",
    );
    expect(link).toHaveTextContent("3 张 · 家庭照片 / 2023年测试相册");
    expect(link).toHaveTextContent("连续拍摄时间 · 同一地点 · 其余 1 类");
    expect(
      screen.getByRole("heading", { name: "2023年测试相册" }),
    ).toBeInTheDocument();
  });

  it("按维度翻页时分组换一批", async () => {
    renderPage();
    await waitFor(() => expect(directoryRequests().length).toBe(1));

    fireEvent.click(screen.getByRole("tab", { name: /人物/ }));
    await waitFor(() =>
      expect(
        directoryRequests().some((request) => request.dimension === "people"),
      ).toBe(true),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "dimension=people",
    );
  });

  it("滑到底会接上下一批分组", async () => {
    renderPage();
    await waitFor(() => expect(directoryRequests().length).toBe(1));
    await screen.findByRole("link", { name: /打开智能相册 2024年春游/ });

    const sentinel = document.querySelector(
      '[data-testid="smart-albums-sentinel"]',
    );
    expect(sentinel).toBeTruthy();
    (
      globalThis as unknown as {
        triggerIntersection: (target: Element) => void;
      }
    ).triggerIntersection(sentinel as Element);

    await waitFor(() => expect(directoryRequests().length).toBe(2));
    expect(directoryRequests()[1].cursor).toBe("cursor-2");
  });
});
