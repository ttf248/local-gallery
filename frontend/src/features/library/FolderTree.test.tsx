import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import FolderTree from "./FolderTree";

vi.mock("../../api/library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/library")>();
  return {
    ...actual,
    libraryApi: {
      childrenAll: vi.fn(),
      overview: vi.fn(),
    },
  };
});

vi.mock("../../hooks/useLibrary", () => ({
  useLibraryManifest: vi.fn(),
  useLibraryAncestors: vi.fn(),
}));

import { libraryApi } from "../../api/library";
import {
  useLibraryAncestors,
  useLibraryManifest,
} from "../../hooks/useLibrary";

function node(
  overrides: Partial<import("../../api/library").LibraryNodeSummary> = {},
): import("../../api/library").LibraryNodeSummary {
  return {
    id: "c_1",
    kind: "collection",
    name: "2025",
    displayName: "2025",
    contentKind: "photo",
    albumCount: 3,
    ...overrides,
  } as import("../../api/library").LibraryNodeSummary;
}

function renderTree(selectedId = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onSelect = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FolderTree mode="photo" selectedId={selectedId} onSelect={onSelect} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSelect };
}

describe("目录树", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLibraryManifest).mockReturnValue({
      data: {
        manifest: {
          roots: [
            { id: "r1", name: "存照", contentKind: "photo" },
            { id: "r2", name: "漫画根", contentKind: "comic" },
          ],
          statistics: { albumCount: 3 },
        },
      },
      isLoading: false,
    } as never);
    vi.mocked(useLibraryAncestors).mockReturnValue({
      data: [],
      isLoading: false,
    } as never);
    vi.mocked(libraryApi.childrenAll).mockResolvedValue([]);
    vi.mocked(libraryApi.overview).mockResolvedValue({
      ok: true,
      page: {
        items: [],
        counts: { all: 0, album: 0, collection: 0, smart: 0 },
        years: [],
        series: [],
      },
    } as never);
  });

  it("只列当前这一侧的媒体根", () => {
    renderTree();
    expect(screen.getByRole("button", { name: "存照" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "漫画根" })).toBeNull();
  });

  it("顶层时不摊开媒体根：根下面常常是几十个年份，全部列出来就是一份巨大的导航列表", async () => {
    vi.mocked(libraryApi.childrenAll).mockResolvedValue([
      node({ id: "c_1", name: "2025" }),
    ]);
    renderTree();

    // 根自己看得见：它就是库的第一层。
    expect(screen.getByRole("button", { name: "存照" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "展开 存照" }),
    ).toBeInTheDocument();
    // 子项既不列出来，也不去取：没展开就不读。
    expect(screen.queryByRole("button", { name: "2025" })).toBeNull();
    expect(libraryApi.childrenAll).not.toHaveBeenCalled();
  });

  it("站在某一层里时自动展开到那一层", async () => {
    // 祖先链从媒体根一路排到当前节点（后端就是这么给的）。
    vi.mocked(useLibraryAncestors).mockReturnValue({
      data: [
        { id: "r1", sourceRoot: "r1" },
        { id: "c_1", sourceRoot: "r1" },
      ],
      isLoading: false,
    } as never);
    vi.mocked(libraryApi.childrenAll).mockImplementation(async (id: string) =>
      id === "r1"
        ? [node({ id: "c_1", name: "2025" })]
        : [
            node({
              id: "a_1",
              name: "相册",
              displayName: "相册",
              kind: "album",
            }),
          ],
    );

    renderTree("c_1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "相册" })).toBeInTheDocument(),
    );
    expect(libraryApi.childrenAll).toHaveBeenCalledWith(
      "c_1",
      "photo",
      expect.anything(),
    );
  });

  it("能手动展开与收起", async () => {
    vi.mocked(libraryApi.childrenAll).mockResolvedValue([
      node({ id: "c_1", name: "2025" }),
    ]);
    renderTree();

    // 展开根：子项列出来。
    fireEvent.click(screen.getByRole("button", { name: "展开 存照" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "2025" })).toBeInTheDocument(),
    );
    expect(libraryApi.childrenAll).toHaveBeenCalledWith(
      "r1",
      "photo",
      expect.anything(),
    );

    // 再收起：树里只剩根自己。
    fireEvent.click(screen.getByRole("button", { name: "收起 存照" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "2025" })).toBeNull(),
    );

    // 再展开：内容还在。
    fireEvent.click(screen.getByRole("button", { name: "展开 存照" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "2025" })).toBeInTheDocument(),
    );
  });

  it("能按名字定位：搜到就跳过去", async () => {
    vi.mocked(libraryApi.overview).mockResolvedValue({
      ok: true,
      page: {
        items: [
          {
            kind: "collection",
            node: node({ id: "c_9", name: "海边", displayName: "海边" }),
          },
        ],
        counts: { all: 1, album: 0, collection: 1, smart: 0 },
        years: [],
        series: [],
      },
    } as never);
    const { onSelect } = renderTree();

    fireEvent.change(screen.getByLabelText("在目录中定位"), {
      target: { value: "海边" },
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /海边/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /海边/ }));
    expect(onSelect).toHaveBeenCalledWith("c_9");
  });

  it("定位没有命中时说明白", async () => {
    renderTree();
    fireEvent.change(screen.getByLabelText("在目录中定位"), {
      target: { value: "没有这个" },
    });
    await waitFor(() =>
      expect(screen.getByText(/没有找到/)).toBeInTheDocument(),
    );
  });
});
