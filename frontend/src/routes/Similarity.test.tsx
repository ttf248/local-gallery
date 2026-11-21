import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Similarity from "./Similarity";
import { useUIStore } from "../store/uiStore";
import type { SimilarityGroup, SimilarityGroupPage } from "../api/similarity";

const requests: {
  kind: string;
  status: string;
  folder: string;
  limit: number;
  offset: number;
}[] = [];

const updates: { id: string; body: Record<string, unknown> }[] = [];
const batches: { action: string; groupIds: string[] }[] = [];
const virtualState = vi.hoisted(() => ({
  windowSize: 1,
  totalGroups: 121,
  loadedGroups: 0,
  useWindowScroll: false,
  endReached: null as (() => void) | null,
}));

function groupFixture(
  overrides: Partial<SimilarityGroup> = {},
): SimilarityGroup {
  return {
    id: "exact-1",
    kind: "exact",
    folder: "存照/2024",
    resourceIds: ["f_a", "f_b"],
    members: [
      {
        resourceId: "f_a",
        folder: "存照/2024",
        albumId: "a_1",
        albumName: "2024",
        width: 4000,
        height: 3000,
        quality: {
          sharpness: 820,
          sharpnessScore: 0.86,
          megapixels: 12,
          resolutionScore: 0.82,
          exposure: 0.45,
          clippedHigh: 0.02,
          clippedLow: 0.01,
          exposureScore: 0.9,
          score: 0.86,
        },
        capturedAt: "2024-05-01T10:00:00Z",
        distance: 0,
        similarity: 1,
        score: 0.86,
      },
      {
        resourceId: "f_b",
        folder: "存照/2024",
        albumId: "a_1",
        albumName: "2024",
        width: 4000,
        height: 3000,
        quality: {
          sharpness: 120,
          sharpnessScore: 0.4,
          megapixels: 12,
          resolutionScore: 0.82,
          exposure: 0.45,
          clippedHigh: 0.02,
          clippedLow: 0.01,
          exposureScore: 0.9,
          score: 0.62,
        },
        capturedAt: "2024-05-01T10:00:00Z",
        distance: 0,
        similarity: 1,
        score: 0.62,
      },
    ],
    recommended: "f_a",
    representative: "f_a",
    representativeIsManual: false,
    distance: 0,
    similarity: 1,
    timeSpanMs: 0,
    timeSource: "capture",
    crossFolder: false,
    status: "pending",
    redundant: 1,
    ...overrides,
  };
}

function pageFixture(
  groups: SimilarityGroup[],
  total = groups.length + 120,
): SimilarityGroupPage {
  return {
    revision: 1,
    // 命中数比返回的组数多：库大时分组会分页接下一批。
    total,
    groups,
    folders: [
      { folder: "存照/2024", groups: groups.length, photos: groups.length * 2 },
    ],
    summary: {
      exact: groups.filter((group) => group.kind === "exact").length,
      near: groups.filter((group) => group.kind === "near").length,
      burst: groups.filter((group) => group.kind === "burst").length,
      pending: groups.filter((group) => group.status === "pending").length,
      reviewed: groups.filter((group) => group.status === "reviewed").length,
      ignored: 0,
      photos: groups.length * 2,
      redundant: groups.reduce((total, group) => total + group.redundant, 0),
    },
    stale: false,
    limited: false,
  };
}

vi.mock("../api/similarity", async (original) => ({
  ...(await original<typeof import("../api/similarity")>()),
  similarityApi: {
    status: () =>
      Promise.resolve({
        ok: true,
        status: {
          analyzed: 120,
          total: 120,
          hasVectors: true,
          builtAt: "2026-11-18T10:00:00Z",
          stale: false,
          rebuilding: false,
          limited: false,
          summary: pageFixture([]).summary,
        },
      }),
    groups: (
      query: {
        kind?: string;
        status?: string;
        folder?: string;
        limit?: number;
        offset?: number;
      } = {},
    ) => {
      const offset = query.offset ?? 0;
      const total = virtualState.totalGroups;
      requests.push({
        kind: query.kind ?? "",
        status: query.status ?? "",
        folder: query.folder ?? "",
        limit: query.limit ?? 0,
        offset,
      });
      const count = Math.max(0, Math.min(query.limit ?? 60, total - offset));
      const groups = Array.from({ length: count }, (_, index) => {
        const groupIndex = offset + index;
        return groupFixture({
          id:
            query.kind === "burst"
              ? `burst-${groupIndex + 1}`
              : groupIndex === 0
                ? "exact-1"
                : `exact-${groupIndex + 1}`,
          kind: query.kind === "burst" ? "burst" : "exact",
          representativeIsManual: false,
        });
      });
      return Promise.resolve({ ok: true, page: pageFixture(groups, total) });
    },
    update: (id: string, body: Record<string, unknown>) => {
      updates.push({ id, body });
      return Promise.resolve({ ok: true });
    },
    batch: (action: string, groupIds: string[]) => {
      batches.push({ action, groupIds });
      return Promise.resolve({ ok: true, changed: groupIds.length });
    },
  },
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
    useWindowScroll,
    endReached,
  }: {
    data: SimilarityGroup[];
    itemContent: (index: number, group: SimilarityGroup) => ReactNode;
    useWindowScroll?: boolean;
    endReached?: () => void;
  }) => {
    virtualState.loadedGroups = data.length;
    virtualState.useWindowScroll = useWindowScroll ?? false;
    virtualState.endReached = endReached ?? null;
    return (
      <div data-testid="similarity-virtual-list" data-groups={data.length}>
        {data.slice(0, virtualState.windowSize).map((group, index) => (
          <div key={group.id}>{itemContent(index, group)}</div>
        ))}
      </div>
    );
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.search}</span>;
}

function renderPage(initialEntry = "/photo/similarity") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Similarity />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("相似照片整理页", () => {
  beforeEach(() => {
    virtualState.windowSize = 1;
    virtualState.totalGroups = 121;
    virtualState.loadedGroups = 0;
    virtualState.useWindowScroll = false;
    virtualState.endReached = null;
    requests.length = 0;
    updates.length = 0;
    batches.length = 0;
    useUIStore.setState({ toasts: [] });
  });

  it("按三类结果分别列出分组，并说清这一类是什么", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    const card = screen.getByTestId("similarity-group");
    expect(card).toHaveAttribute("data-group-kind", "exact");
    expect(within(card).getByText("完全重复")).toBeInTheDocument();
    expect(within(card).getByText(/2 张/)).toBeInTheDocument();
    // 代表照片的质量分项是分开写的，不是揉成一个总分。
    expect(within(card).getByText(/清晰 86/)).toBeInTheDocument();
    expect(within(card).getByText(/12\.0MP/)).toBeInTheDocument();
    expect(within(card).getByText(/曝光 90/)).toBeInTheDocument();
    expect(screen.getByTestId("similarity-summary")).toHaveTextContent(
      "完全重复 60 组",
    );
  });

  it("展开后并排摆出成员，点成员即把它设为代表", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    const members = screen.getAllByTestId("similarity-member");
    expect(members).toHaveLength(2);

    fireEvent.click(
      within(members[1]).getByRole("button", { name: /设为代表照片/ }),
    );
    await waitFor(() =>
      expect(updates).toContainEqual({
        id: "exact-1",
        body: { representative: "f_b" },
      }),
    );
  });

  it("标记已处理与忽略各写各的决定", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("button", { name: "标记已处理" }));
    await waitFor(() =>
      expect(updates).toContainEqual({
        id: "exact-1",
        body: { reviewed: true },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "忽略" }));
    await waitFor(() =>
      expect(updates).toContainEqual({
        id: "exact-1",
        body: { ignored: true },
      }),
    );
  });

  it("批量把选中的组加入精选", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("checkbox", { name: /选中这一组/ }));
    const bar = await screen.findByTestId("similarity-batch-bar");
    fireEvent.click(within(bar).getByRole("button", { name: /加入精选/ }));

    await waitFor(() =>
      expect(batches).toContainEqual({ action: "pick", groupIds: ["exact-1"] }),
    );
  });

  it("筛选条件写进地址栏，深链能直接落到某个切面", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("radio", { name: "连拍" }));
    await waitFor(() => {
      expect(requests.some((request) => request.kind === "burst")).toBe(true);
    });
    expect(screen.getByTestId("location")).toHaveTextContent("kind=burst");
  });

  it("单组的加入精选不必先勾选这一组", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    const card = screen.getByTestId("similarity-group");
    fireEvent.click(within(card).getByRole("button", { name: "加入精选" }));

    await waitFor(() =>
      expect(batches).toContainEqual({ action: "pick", groupIds: ["exact-1"] }),
    );
  });

  it("分组太多时可以再接下一批", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    // 第二次请求只取下一页，不扩大首个请求的 limit 重下旧组。
    requests.length = 0;
    const more = await screen.findByRole("button", { name: /再显示 60 组/ });
    fireEvent.click(more);

    await waitFor(() => {
      expect(requests.map((request) => request.offset)).toEqual([60]);
    });
  });

  it("虚拟列表滚到末组时自动追加下一页", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");
    requests.length = 0;

    act(() => virtualState.endReached?.());

    await waitFor(() => {
      expect(requests.map((request) => request.offset)).toEqual([60]);
      expect(virtualState.loadedGroups).toBe(120);
    });
  });

  it("追加下一页后仍保留已展开分组和用户选择", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /选中这一组/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /再显示 60 组/ }),
    );

    await waitFor(() => expect(virtualState.loadedGroups).toBe(120));
    expect(screen.getAllByTestId("similarity-member")).toHaveLength(2);
    expect(screen.getByTestId("similarity-batch-bar")).toHaveTextContent(
      "已选 1 组",
    );
  });

  it(
    "5000 组已加载时仍只挂载虚拟窗口内的条目",
    async () => {
      virtualState.totalGroups = 5000;
      virtualState.windowSize = 6;
      renderPage();
      expect(await screen.findAllByTestId("similarity-group")).toHaveLength(6);

      while (virtualState.loadedGroups < 5000) {
        const expected = Math.min(virtualState.loadedGroups + 60, 5000);
        fireEvent.click(
          await screen.findByRole("button", { name: /再显示 60 组/ }),
        );
        await waitFor(() =>
          expect(
            screen.getByTestId("similarity-virtual-list"),
          ).toHaveAttribute("data-groups", String(expected)),
        );
      }

      expect(virtualState.useWindowScroll).toBe(true);
      expect(virtualState.loadedGroups).toBe(5000);
      expect(screen.getAllByTestId("similarity-group")).toHaveLength(6);
    },
    20_000,
  );

  it("地址栏里的类别参数会被认出来", async () => {
    renderPage("/photo/similarity?kind=burst");
    await screen.findByTestId("similarity-group");
    expect(requests[0].kind).toBe("burst");
    expect(screen.getByRole("radio", { name: "连拍" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("默认落在待处理：打开这一页就是还没处理的那一列", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    expect(requests[0].status).toBe("pending");
    expect(screen.getByRole("radio", { name: "待处理" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("切到已处理会改筛选，并把状态写进地址栏", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("radio", { name: "已处理" }));

    await waitFor(() => {
      expect(requests.some((request) => request.status === "reviewed")).toBe(
        true,
      );
    });
    expect(screen.getByTestId("location")).toHaveTextContent("status=reviewed");
  });

  it("标记已处理后给出撤销，撤销把它放回待处理", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("button", { name: "标记已处理" }));

    await waitFor(() =>
      expect(
        useUIStore.getState().toasts.some(
          (toast) => toast.message === "已把这一组标记为已处理",
        ),
      ).toBe(true),
    );
    const toast = useUIStore
      .getState()
      .toasts.find((item) => item.message === "已把这一组标记为已处理");
    expect(toast?.action?.label).toBe("撤销");

    await act(async () => {
      toast?.action?.onClick();
    });

    await waitFor(() =>
      expect(updates).toContainEqual({
        id: "exact-1",
        body: { reviewed: false },
      }),
    );
  });

  it("批量忽略说清忽略了多少组，也能整体撤销", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("checkbox", { name: /选中这一组/ }));
    const bar = await screen.findByTestId("similarity-batch-bar");
    fireEvent.click(within(bar).getByRole("button", { name: "忽略" }));

    await waitFor(() =>
      expect(batches).toContainEqual({
        action: "ignore",
        groupIds: ["exact-1"],
      }),
    );
    await waitFor(() =>
      expect(
        useUIStore.getState().toasts.some(
          (toast) => toast.message === "已忽略 1 组",
        ),
      ).toBe(true),
    );

    const toast = useUIStore
      .getState()
      .toasts.find((item) => item.message === "已忽略 1 组");
    await act(async () => {
      toast?.action?.onClick();
    });
    await waitFor(() =>
      expect(batches).toContainEqual({
        action: "unignore",
        groupIds: ["exact-1"],
      }),
    );
  });

  it("批量标记已处理与批量忽略的反馈不混着说", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("checkbox", { name: /选中这一组/ }));
    const bar = await screen.findByTestId("similarity-batch-bar");
    fireEvent.click(within(bar).getByRole("button", { name: "标记已处理" }));

    await waitFor(() =>
      expect(
        useUIStore.getState().toasts.some(
          (toast) => toast.message === "已把 1 组标记为已处理",
        ),
      ).toBe(true),
    );
  });
});
