import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import FolderTree from "./FolderTree";

vi.mock("../../api/library", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../api/library")>();
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
      page: { items: [], counts: { all: 0, album: 0, collection: 0, smart: 0 }, years: [], series: [] },
    } as never);
  });

  it("只列当前这一侧的媒体根", () => {
    renderTree();
    expect(screen.getByRole("button", { name: "存照" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "漫画根" })).toBeNull();
  });

  it("默认只展开媒体根那一层，更深的层级不展开", async () => {
    vi.mocked(libraryApi.childrenAll).mockResolvedValue([
      node({ id: "c_1", name: "2025" }),
    ]);
    renderTree();

    // 根那一层看得见：它就是库的第一层。
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "2025" })).toBeInTheDocument(),
    );
    // 更深的一层不展开：不站在那一层里，就不读它的子项。
    expect(libraryApi.childrenAll).toHaveBeenCalledTimes(1);
    expect(libraryApi.childrenAll).toHaveBeenCalledWith(
      "r1",
      "photo",
      expect.anything(),
    );
    expect(screen.getByRole("button", { name: "展开 2025" })).toBeInTheDocument();
  });

  it("站在某一层里时自动展开到那一层", async () => {
    vi.mocked(useLibraryAncestors).mockReturnValue({
      data: [{ id: "c_1", sourceRoot: "r1" }],
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

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "2025" })).toBeInTheDocument(),
    );

    // 收起根那一层：树里只剩根自己。
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
