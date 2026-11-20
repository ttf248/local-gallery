import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SmartAlbums from "./SmartAlbums";
import type {
  SmartAlbumDirectoryDimension,
  SmartAlbumSort,
} from "../api/albums";
import { useAppModeStore } from "../store/appModeStore";

const requests: {
  dimension: SmartAlbumDirectoryDimension;
  cursor?: string;
  limit?: number;
  sort?: SmartAlbumSort;
}[] = [];

vi.mock("../api/albums", async (original) => ({
  ...(await original<typeof import("../api/albums")>()),
  albumsApi: {
    smartDirectory: (
      dimension: SmartAlbumDirectoryDimension,
      options: {
        cursor?: string;
        limit?: number;
        sort?: SmartAlbumSort;
      } = {},
    ) => {
      requests.push({
        dimension,
        cursor: options.cursor,
        limit: options.limit,
        sort: options.sort,
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
                dimension: dimension === "all" ? "time" : dimension,
                name: page === 1 ? "2024年春游" : "2024年夏游",
                suggestedName: "2024年春游",
                customName: false,
                photoCount: 3,
                coverResourceId: "f_cover",
                coverVersion: "v1",
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

/** 专页只调用推荐目录，统计该目录的分页请求。 */
function directoryRequests() {
  return requests;
}

function renderPage(initialEntry = "/photo/smart-albums") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
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

  it("专页只加载精选推荐，不显示分类页签", async () => {
    renderPage();
    await waitFor(() => expect(directoryRequests().length).toBe(1));

    expect(directoryRequests().map((request) => request.dimension)).toEqual([
      "recommended",
    ]);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    // 标题是看得见的：这一页有排序要切，排序控件就在标题这一行。
    expect(screen.getByRole("heading", { name: "精选推荐" })).not.toHaveClass(
      "sr-only",
    );
    expect(
      screen.queryByText(/精选推荐至少 12 张、至少两类线索一致/),
    ).toBeNull();

    const link = await screen.findByRole("link", {
      name: /打开智能相册 2024年春游/,
    });
    expect(link).toHaveAttribute(
      "href",
      "/photo/albums/a_1?dimension=recommended&group=sg_0123456789abcdef0121",
    );
    expect(link).toHaveTextContent("3 张 · 家庭照片 / 2023年测试相册");
    // 推荐卡片第三行是证据维度芯片，不再是一串平铺的理由。
    const evidence = within(link).getByTestId("smart-album-evidence");
    expect(evidence).toHaveTextContent("时间");
    expect(evidence).toHaveTextContent("地点");
    expect(evidence).toHaveTextContent("场景");
    expect(link).not.toHaveTextContent("其余 1 类");
    // 专页不再按相册分块：来源相册写在卡片上。
    expect(
      screen.queryByRole("heading", { name: "2023年测试相册" }),
    ).toBeNull();
  });

  it("旧分类深链会回到精选推荐并清理维度参数", async () => {
    renderPage("/photo/smart-albums?dimension=people");
    await waitFor(() => expect(directoryRequests().length).toBe(1));

    expect(directoryRequests()[0].dimension).toBe("recommended");
    await waitFor(() =>
      expect(screen.getByTestId("location")).toBeEmptyDOMElement(),
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

  it("默认按时间倒序，切换排序会重取目录并写进地址栏", async () => {
    renderPage();
    await waitFor(() => expect(directoryRequests().length).toBe(1));
    expect(directoryRequests()[0].sort).toBe("time");

    const photos = screen.getByRole("radio", { name: "照片最多" });
    photos.click();

    await waitFor(() => expect(directoryRequests().length).toBe(2));
    expect(directoryRequests()[1].sort).toBe("photos");
    expect(screen.getByTestId("location")).toHaveTextContent("sort=photos");
    expect(screen.getByRole("radio", { name: "照片最多" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("地址栏里的排序参数会被认出来", async () => {
    renderPage("/photo/smart-albums?sort=quality");
    await waitFor(() => expect(directoryRequests().length).toBe(1));
    expect(directoryRequests()[0].sort).toBe("quality");
    expect(screen.getByRole("radio", { name: "推荐最强" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
