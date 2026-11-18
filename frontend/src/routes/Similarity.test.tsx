import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Similarity from "./Similarity";
import type { SimilarityGroup, SimilarityGroupPage } from "../api/similarity";

const requests: {
  kind: string;
  status: string;
  folder: string;
}[] = [];

const updates: { id: string; body: Record<string, unknown> }[] = [];
const batches: { action: string; groupIds: string[] }[] = [];

function groupFixture(overrides: Partial<SimilarityGroup> = {}): SimilarityGroup {
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

function pageFixture(groups: SimilarityGroup[]): SimilarityGroupPage {
  return {
    revision: 1,
    total: groups.length,
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
    groups: (query: { kind?: string; status?: string; folder?: string } = {}) => {
      requests.push({
        kind: query.kind ?? "",
        status: query.status ?? "",
        folder: query.folder ?? "",
      });
      const groups = [groupFixture()];
      if (query.kind === "burst") {
        groups[0] = groupFixture({
          id: "burst-1",
          kind: "burst",
          representativeIsManual: false,
        });
      }
      return Promise.resolve({ ok: true, page: pageFixture(groups) });
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
    requests.length = 0;
    updates.length = 0;
    batches.length = 0;
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
      "1 组完全重复",
    );
  });

  it("展开后并排摆出成员，点成员即把它设为代表", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    const members = screen.getAllByTestId("similarity-member");
    expect(members).toHaveLength(2);

    fireEvent.click(within(members[1]).getByRole("button", { name: /设为代表照片/ }));
    await waitFor(() =>
      expect(updates).toContainEqual({
        id: "exact-1",
        body: { representative: "f_b" },
      }),
    );
  });

  it("标记已审查与忽略各写各的决定", async () => {
    renderPage();
    await screen.findByTestId("similarity-group");

    fireEvent.click(screen.getByRole("button", { name: "已审查" }));
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

    fireEvent.click(
      screen.getByRole("checkbox", { name: /选中这一组/ }),
    );
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

  it("地址栏里的类别参数会被认出来", async () => {
    renderPage("/photo/similarity?kind=burst");
    await screen.findByTestId("similarity-group");
    expect(requests[0].kind).toBe("burst");
    expect(screen.getByRole("radio", { name: "连拍" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
