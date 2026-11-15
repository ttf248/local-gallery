import { describe, it, expect, vi, beforeEach } from "vitest";
import { forwardRef, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RandomPhotos from "./RandomPhotos";
import { useAppModeStore } from "../store/appModeStore";

const requests: { seed?: string }[] = [];

vi.mock("../api/library", () => ({
  libraryApi: {
    mediaFeed: (query: { seed?: string }) => {
      requests.push({ seed: query.seed });
      return Promise.resolve({
        ok: true,
        page: {
          revision: 1,
          total: 2,
          items: [
            {
              id: `f_${query.seed ?? "none"}_1`,
              kind: "image",
              name: "一.jpg",
              index: 0,
              kindIndex: 0,
              albumId: "a_1",
              albumName: "第一本",
            },
            {
              id: `f_${query.seed ?? "none"}_2`,
              kind: "image",
              name: "二.jpg",
              index: 1,
              kindIndex: 1,
              albumId: "a_2",
              albumName: "第二本",
            },
          ],
        },
      });
    },
  },
}));

vi.mock("../hooks/usePicks", () => ({
  usePicks: () => ({
    isPicked: () => false,
    toggle: vi.fn(),
    total: 0,
    isLoading: false,
  }),
}));

// 虚拟列表在测试里按行渲染：照片墙要的是「行」，不是滚动行为。
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(
    (
      {
        data,
        itemContent,
      }: {
        data: Array<{ key: string }>;
        itemContent: (index: number, row: { key: string }) => ReactNode;
      },
      _ref: React.ForwardedRef<unknown>,
    ) => (
      <>
        {data.map((row, index) => (
          <div key={row.key} data-testid="wall-row">
            {itemContent(index, row)}
          </div>
        ))}
      </>
    ),
  ),
}));

// 照片墙按容器宽度排布：测试里给一个固定宽度。
vi.mock("../hooks/useElementSize", () => ({
  useElementSize: () => ({ ref: { current: null }, width: 1200, height: 800 }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RandomPhotos />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("随手看看专页", () => {
  beforeEach(() => {
    requests.length = 0;
    useAppModeStore.setState({ preference: "photo", hydrated: true });
  });

  it("墙上铺的是随机抽来的照片", async () => {
    renderPage();
    await waitFor(() => expect(requests.length).toBe(1));
    expect(requests[0].seed).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByTestId("wall-row").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("第一本")).toBeInTheDocument();
  });

  it("换一批换的是取材种子，因此一定换得掉", async () => {
    renderPage();
    await waitFor(() => expect(requests.length).toBe(1));
    const first = requests[0].seed;

    fireEvent.click(screen.getByRole("button", { name: /换一批/ }));
    await waitFor(() => expect(requests.length).toBe(2));
    expect(requests[1].seed).not.toBe(first);
  });
});
