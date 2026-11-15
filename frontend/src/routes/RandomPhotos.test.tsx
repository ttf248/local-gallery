import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RandomPhotos from "./RandomPhotos";
import { useAppModeStore } from "../store/appModeStore";

const requests: { seed?: string; cursor?: string }[] = [];

vi.mock("../api/library", () => ({
  libraryApi: {
    mediaFeed: (query: { seed?: string }, cursor?: string) => {
      requests.push({ seed: query.seed, cursor });
      const page = cursor ? 2 : 1;
      return Promise.resolve({
        ok: true,
        page: {
          revision: 1,
          total: 4,
          nextCursor: page === 1 ? "cursor-2" : "",
          items: [
            {
              id: `f_${page}_1`,
              kind: "image",
              name: `${page}-一.jpg`,
              index: 0,
              kindIndex: 0,
              width: 1200,
              height: 800,
              albumId: "a_1",
              albumName: "第一本",
            },
            {
              id: `f_${page}_2`,
              kind: "image",
              name: `${page}-二.jpg`,
              index: 1,
              kindIndex: 1,
              width: 800,
              height: 1200,
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

// 照片墙按容器宽度排布：测试里给一个固定宽度。
vi.mock("../hooks/useElementSize", () => ({
  useElementSize: () => ({
    ref: () => {},
    width: 1200,
    height: 800,
    element: null,
  }),
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
      expect(screen.getByAltText("1-一.jpg")).toBeInTheDocument(),
    );
    expect(screen.getByAltText("1-二.jpg")).toBeInTheDocument();
    // 照片的出处相册写在悬停层里。
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

  it("滑到底会接上下一批照片", async () => {
    renderPage();
    await waitFor(() => expect(requests.length).toBe(1));
    await waitFor(() =>
      expect(screen.getByAltText("1-一.jpg")).toBeInTheDocument(),
    );

    const sentinel = document.querySelector(
      '[data-testid="random-photos-sentinel"]',
    );
    expect(sentinel).toBeTruthy();
    (
      globalThis as unknown as {
        triggerIntersection: (target: Element) => void;
      }
    ).triggerIntersection(sentinel as Element);

    // 下一页接上来，墙上的照片换成了新一批。
    await waitFor(() => expect(requests.length).toBe(2));
    expect(requests[1].cursor).toBe("cursor-2");
    await waitFor(() =>
      expect(screen.getByAltText("2-一.jpg")).toBeInTheDocument(),
    );
  });
});
