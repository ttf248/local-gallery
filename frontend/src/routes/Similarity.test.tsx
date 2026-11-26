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
import { ApiError } from "../api/client";

const requests: {
  kind: string;
  status: string;
  folder: string;
  limit: number;
  offset: number;
}[] = [];

const updates: { id: string; body: Record<string, unknown> }[] = [];
const batches: { action: string; groupIds: string[] }[] = [];
const restores: { groupId: string; from: string; to: string }[] = [];
const virtualState = vi.hoisted(() => ({
  windowSize: 1,
  totalGroups: 121,
  loadedGroups: 0,
  loadedIds: [] as string[],
  useWindowScroll: false,
  endReached: null as (() => void) | null,
}));

/**
 * 模拟服务端的分组状态。
 *
 * 状态是真的三档，而不是两个布尔：撤销要按每组操作前的那一档恢复，
 * 这一点只有服务端如实记下来才验得了。
 */
const serverState = vi.hoisted(() => ({
  /** 每组当前的状态。 */
  statuses: {} as Record<string, string>,
  /** update 要抛出的错误。 */
  updateError: null as unknown,
  /** batch 要抛出的错误。 */
  batchError: null as unknown,
  /** restore 要抛出的错误。 */
  restoreError: null as unknown,
  /** 指定页码临时失败，用于模拟服务端错误或网络中断。 */
  groupsFailure: null as {
    offset: number;
    remaining: number;
    error: unknown;
  } | null,
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
      const failure = serverState.groupsFailure;
      if (failure && failure.offset === offset && failure.remaining > 0) {
        failure.remaining -= 1;
        return Promise.reject(failure.error);
      }
      const count = Math.max(0, Math.min(query.limit ?? 60, total - offset));
      const groups = Array.from({ length: count }, (_, index) => {
        const groupIndex = offset + index;
        const id =
          query.kind === "burst"
            ? `burst-${groupIndex + 1}`
            : groupIndex === 0
              ? "exact-1"
              : `exact-${groupIndex + 1}`;
        return groupFixture({
          id,
          kind: query.kind === "burst" ? "burst" : "exact",
          representativeIsManual: false,
          status: (serverState.statuses[id] ?? "pending") as
            "pending" | "reviewed" | "ignored",
        });
      });
      return Promise.resolve({ ok: true, page: pageFixture(groups, total) });
    },
    update: (id: string, body: Record<string, unknown>) => {
      updates.push({ id, body });
      if (serverState.updateError) {
        return Promise.reject(serverState.updateError);
      }
      // 服务端记下操作前的状态：撤销要按它恢复回去。
      const previous = serverState.statuses[id] ?? "pending";
      const target = typeof body.status === "string" ? body.status : previous;
      serverState.statuses[id] = target;
      return Promise.resolve({
        ok: true,
        status: target,
        previousStatus: previous,
        changed: previous !== target,
      });
    },
    batch: (action: string, groupIds: string[]) => {
      batches.push({ action, groupIds });
      if (serverState.batchError) {
        return Promise.reject(serverState.batchError);
      }
      if (action === "pick") {
        return Promise.resolve({ ok: true, changed: groupIds.length });
      }
      const previous: Record<string, string> = {};
      const current: Record<string, string> = {};
      let changed = 0;
      for (const id of groupIds) {
        const before = serverState.statuses[id] ?? "pending";
        const target =
          action === "review"
            ? "reviewed"
            : action === "ignore"
              ? "ignored"
              : "pending";
        if (before === target) continue;
        serverState.statuses[id] = target;
        previous[id] = before;
        current[id] = target;
        changed += 1;
      }
      return Promise.resolve({ ok: true, changed, previous, current });
    },
    restore: (entries: { groupId: string; from: string; to: string }[]) => {
      restores.push(...entries);
      if (serverState.restoreError) {
        return Promise.reject(serverState.restoreError);
      }
      const conflicts: string[] = [];
      let changed = 0;
      for (const entry of entries) {
        const current = serverState.statuses[entry.groupId] ?? "pending";
        if (current !== entry.from) {
          conflicts.push(entry.groupId);
          continue;
        }
        serverState.statuses[entry.groupId] = entry.to;
        changed += 1;
      }
      return Promise.resolve({ ok: true, changed, conflicts });
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
    virtualState.loadedIds = data.map((group) => group.id);
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
    virtualState.loadedIds = [];
    virtualState.useWindowScroll = false;
    virtualState.endReached = null;
    requests.length = 0;
    updates.length = 0;
    batches.length = 0;
    restores.length = 0;
    for (const key of Object.keys(serverState.statuses)) {
      delete serverState.statuses[key];
    }
    serverState.updateError = null;
    serverState.batchError = null;
    serverState.restoreError = null;
    serverState.groupsFailure = null;
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
        body: { status: "reviewed" },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "更多组操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "忽略" }));
    await waitFor(() =>
      expect(updates).toContainEqual({
        id: "exact-1",
        body: { status: "ignored" },
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

  it("首屏失败后可以手动重试读取", async () => {
    virtualState.totalGroups = 1;
    serverState.groupsFailure = {
      offset: 0,
      remaining: 1,
      error: new Error("500 Internal Server Error"),
    };

    renderPage();

    expect(
      await screen.findByText("整理结果暂时读不出来。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));

    expect(await screen.findByTestId("similarity-group")).toBeInTheDocument();
    expect(requests.filter((request) => request.offset === 0)).toHaveLength(2);
  });

  it.each([
    ["500", new Error("500 Internal Server Error")],
    ["断网", new TypeError("Failed to fetch")],
  ])("后续分页遇到%s后等待用户重试并保留选择", async (_failure, error) => {
    serverState.groupsFailure = { offset: 60, remaining: 1, error };
    renderPage();
    await screen.findByTestId("similarity-group");

    const selected = screen.getByRole("checkbox", { name: /选中这一组/ });
    fireEvent.click(selected);
    expect(selected).toBeChecked();

    act(() => virtualState.endReached?.());
    expect(
      await screen.findByText("后续分组读取失败，已加载的分组仍可整理。"),
    ).toBeInTheDocument();
    expect(virtualState.loadedGroups).toBe(60);
    expect(screen.getByTestId("similarity-batch-bar")).toHaveTextContent(
      "已选 1 组",
    );

    // Virtuoso 可能在同一个可视末尾反复回报 endReached；失败后它不能
    // 再次自动请求，必须等提示条上的手动重试。
    act(() => {
      virtualState.endReached?.();
      virtualState.endReached?.();
    });
    expect(requests.filter((request) => request.offset === 60)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    await waitFor(() => expect(virtualState.loadedGroups).toBe(120));

    expect(virtualState.loadedIds).toEqual(
      Array.from({ length: 120 }, (_, index) => `exact-${index + 1}`),
    );
    expect(new Set(virtualState.loadedIds).size).toBe(120);
    expect(screen.getByRole("checkbox", { name: /选中这一组/ })).toBeChecked();
    expect(requests.filter((request) => request.offset === 60)).toHaveLength(2);
  });

  it("5000 组已加载时仍只挂载虚拟窗口内的条目", async () => {
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
        expect(screen.getByTestId("similarity-virtual-list")).toHaveAttribute(
          "data-groups",
          String(expected),
        ),
      );
    }

    expect(virtualState.useWindowScroll).toBe(true);
    expect(virtualState.loadedGroups).toBe(5000);
    expect(screen.getAllByTestId("similarity-group")).toHaveLength(6);
  }, 20_000);

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
        useUIStore
          .getState()
          .toasts.some((toast) => toast.message === "已标记 1 组"),
      ).toBe(true),
    );
    const toast = useUIStore
      .getState()
      .toasts.find((item) => item.message === "已标记 1 组");
    expect(toast?.action?.label).toBe("撤销");

    await act(async () => {
      toast?.action?.onClick();
    });

    // 撤销按「操作前的状态」回去：待处理的组被标记已处理之后，
    // 撤销要写回 pending，并带上「操作后是哪一档」做并发校验。
    await waitFor(() =>
      expect(updates).toContainEqual({
        id: "exact-1",
        body: { status: "pending", expectedStatus: "reviewed" },
      }),
    );
    expect(serverState.statuses["exact-1"]).toBe("pending");
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
        useUIStore
          .getState()
          .toasts.some((toast) => toast.message === "已忽略 1 组"),
      ).toBe(true),
    );

    const toast = useUIStore
      .getState()
      .toasts.find((item) => item.message === "已忽略 1 组");
    await act(async () => {
      toast?.action?.onClick();
    });
    // 撤销走恢复接口，并带上每一组自己的原状态。
    await waitFor(() =>
      expect(restores).toContainEqual({
        groupId: "exact-1",
        from: "ignored",
        to: "pending",
      }),
    );
    expect(serverState.statuses["exact-1"]).toBe("pending");
  });

  // 撤销要按每组操作前的那一档恢复。
  //
  // 状态是三档：「已忽略」的组被标记为已处理之后，原来的「已忽略」
  // 就找不回来了 —— 撤销时只翻一个布尔，那一组会掉进「待处理」，
  // 用户明明说「我不想再看它」。
  it("已忽略的组标记为已处理后，撤销回到已忽略而不是待处理", async () => {
    serverState.statuses["exact-1"] = "ignored";
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("button", { name: "标记已处理" }));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0].body).toEqual({ status: "reviewed" });

    const toast = useUIStore
      .getState()
      .toasts.find((item) => item.message === "已标记 1 组");
    expect(toast?.action?.label).toBe("撤销");
    await act(async () => {
      toast?.action?.onClick();
    });

    await waitFor(() => expect(updates).toHaveLength(2));
    // 回到「已忽略」，并带上「操作后是哪一档」做并发校验。
    expect(updates[1].body).toEqual({
      status: "ignored",
      expectedStatus: "reviewed",
    });
    expect(serverState.statuses["exact-1"]).toBe("ignored");
  });

  it("已处理的组忽略后，撤销回到已处理而不是待处理", async () => {
    serverState.statuses["exact-1"] = "reviewed";
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("button", { name: "更多组操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "忽略" }));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0].body).toEqual({ status: "ignored" });

    const toast = useUIStore
      .getState()
      .toasts.find((item) => item.message === "已忽略这一组");
    await act(async () => {
      toast?.action?.onClick();
    });

    await waitFor(() => expect(updates).toHaveLength(2));
    expect(updates[1].body).toEqual({
      status: "reviewed",
      expectedStatus: "ignored",
    });
    expect(serverState.statuses["exact-1"]).toBe("reviewed");
  });

  // 「全部」视图里的组状态不一：批量撤销必须按组恢复，
  // 不能统一翻一个布尔 —— 那会把用户的选择弄乱。
  it("混合状态的批量修改，撤销按每组各自恢复", async () => {
    virtualState.windowSize = 2;
    serverState.statuses["exact-1"] = "ignored";
    serverState.statuses["exact-2"] = "pending";
    renderPage();
    await screen.findAllByTestId("similarity-group");

    const boxes = screen.getAllByRole("checkbox", { name: /选中这一组/ });
    for (const box of boxes) fireEvent.click(box);
    const bar = await screen.findByTestId("similarity-batch-bar");
    fireEvent.click(within(bar).getByRole("button", { name: "标记已处理" }));

    await waitFor(() =>
      expect(batches).toContainEqual({
        action: "review",
        groupIds: ["exact-1", "exact-2"],
      }),
    );

    const toast = useUIStore
      .getState()
      .toasts.find((item) => item.message === "已把 2 组标记为已处理");
    expect(toast?.action?.label).toBe("撤销");
    await act(async () => {
      toast?.action?.onClick();
    });

    await waitFor(() => expect(restores).toHaveLength(2));
    // 每一组各自回到自己原来的那一档。
    expect(restores).toContainEqual({
      groupId: "exact-1",
      from: "reviewed",
      to: "ignored",
    });
    expect(restores).toContainEqual({
      groupId: "exact-2",
      from: "reviewed",
      to: "pending",
    });
    expect(serverState.statuses["exact-1"]).toBe("ignored");
    expect(serverState.statuses["exact-2"]).toBe("pending");
  });

  // 重复操作不产生假的 changed：本来就是已处理的组再标记一次，
  // 界面上不能说「已把 1 组标记为已处理」—— 实际上一组都没动。
  it("本来就在目标状态的组不算变化，反馈不说假话", async () => {
    serverState.statuses["exact-1"] = "reviewed";
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("checkbox", { name: /选中这一组/ }));
    const bar = await screen.findByTestId("similarity-batch-bar");
    fireEvent.click(within(bar).getByRole("button", { name: "标记已处理" }));

    await waitFor(() =>
      expect(batches).toContainEqual({
        action: "review",
        groupIds: ["exact-1"],
      }),
    );
    await waitFor(() =>
      expect(
        useUIStore
          .getState()
          .toasts.some((toast) => toast.message === "没有组需要标记为已处理"),
      ).toBe(true),
    );
    // 没有变化就没有可撤销的东西。
    expect(
      useUIStore
        .getState()
        .toasts.some((toast) => toast.action?.label === "撤销"),
    ).toBe(false);
  });

  // 撤销过期：用户在这之后又改过这一组，撤销写不进去。
  // 这时要说清楚为什么撤销不了，不能谎报恢复成功。
  it("撤销遇到已经改过的组时如实说撤销不了", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("button", { name: "标记已处理" }));
    await waitFor(() => expect(updates).toHaveLength(1));

    serverState.updateError = new ApiError(
      409,
      "conflict",
      undefined,
      "similarity_status_conflict",
    );
    const toast = useUIStore
      .getState()
      .toasts.find((item) => item.message === "已标记 1 组");
    await act(async () => {
      toast?.action?.onClick();
    });

    await waitFor(() =>
      expect(
        useUIStore
          .getState()
          .toasts.some(
            (item) => item.message === "没能撤销：这一组之后又改过，撤销不了",
          ),
      ).toBe(true),
    );
    expect(
      useUIStore
        .getState()
        .toasts.some((item) => item.message === "已恢复原状态"),
    ).toBe(false);
  });

  it("批量标记已处理与批量忽略的反馈不混着说", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("checkbox", { name: /选中这一组/ }));
    const bar = await screen.findByTestId("similarity-batch-bar");
    fireEvent.click(within(bar).getByRole("button", { name: "标记已处理" }));

    await waitFor(() =>
      expect(
        useUIStore
          .getState()
          .toasts.some((toast) => toast.message === "已把 1 组标记为已处理"),
      ).toBe(true),
    );
  });
});
