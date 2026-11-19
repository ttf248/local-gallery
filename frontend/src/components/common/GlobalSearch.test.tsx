import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GlobalSearch from "./GlobalSearch";
import { albumsApi } from "../../api/albums";

vi.mock("../../api/albums", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/albums")>();
  return {
    ...actual,
    albumsApi: { ...actual.albumsApi, search: vi.fn() },
  };
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderSearch(initialEntry = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <GlobalSearch />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("GlobalSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("搜索框有可访问名称", () => {
    renderSearch();
    expect(
      screen.getByRole("combobox", { name: "搜索相册或标签" }),
    ).toBeInTheDocument();
  });

  it("只从名称搜索结果路径预填关键词", () => {
    renderSearch("/photo/search?q=直接搜索");
    expect(screen.getByRole("combobox")).toHaveValue("直接搜索");
  });

  it("列表页地址里的 q 不会被当成全局搜索草稿", () => {
    renderSearch("/photo/library?q=列表筛选&min=2");
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("在列表页输入搜索草稿不改写当前筛选地址", () => {
    renderSearch("/photo/library?q=列表筛选&min=2");
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "新的搜索词" } });

    expect(input).toHaveValue("新的搜索词");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/photo/library?q=列表筛选&min=2",
    );
  });

  it("在请求完成后显示建议，并可用键盘选择标签页", async () => {
    vi.mocked(albumsApi.search).mockResolvedValue({
      ok: true,
      count: 2,
      results: [
        { kind: "album", path: "a_trip", name: "旅行册", count: 12 },
        {
          kind: "smartCollection",
          path: "smart:旅行",
          name: "旅行",
          count: 1,
        },
      ],
    });
    renderSearch();
    const input = screen.getByRole("combobox");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "旅行" } });

    await waitFor(() => expect(albumsApi.search).toHaveBeenCalledWith("旅行", "photo", 10));
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    // 建议先到，但不默认选中第一条：回车该落到「看得见结果」的那一页，
    // 而不是替用户挑第一条直接打开。
    expect(screen.getByRole("option", { name: /旅行册/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    // 往下走两下才到标签：第一下选第一条（相册），第二下选标签。
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /旅行册/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("location")).toHaveTextContent("/tags/%E6%97%85%E8%A1%8C");
  });

  it("没有选中建议时回车落到结果页", async () => {
    vi.mocked(albumsApi.search).mockResolvedValue({
      ok: true,
      count: 1,
      results: [{ kind: "album", path: "a_trip", name: "旅行册", count: 12 }],
    });
    renderSearch();
    const input = screen.getByRole("combobox");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "旅行" } });
    await screen.findByRole("listbox");

    fireEvent.keyDown(input, { key: "Enter" });

    // 关键词进地址，结果页把它显示成一页清单。
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/photo/search?q=%E6%97%85%E8%A1%8C",
    );
  });

  it("搜索结果的计数单位跟着当前工作台走", async () => {
    vi.mocked(albumsApi.search).mockResolvedValue({
      ok: true,
      count: 2,
      results: [
        { kind: "album", path: "a_trip", name: "旅行册", count: 12 },
        { kind: "collection", path: "c_trip", name: "旅行", count: 3 },
      ],
    });
    renderSearch();
    const input = screen.getByRole("combobox");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "旅行" } });

    // 照片工作台：相册按「张」，集合按「本」。
    expect(await screen.findByText("12 张")).toBeInTheDocument();
    expect(screen.getByText("3 本相册")).toBeInTheDocument();
    expect(screen.queryByText(/卷/)).not.toBeInTheDocument();
  });

  it("在建议请求尚未结束时不误报无结果", async () => {
    let resolveSearch: ((value: {
      ok: boolean;
      count: number;
      results: [];
    }) => void) | undefined;
    vi.mocked(albumsApi.search).mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );
    renderSearch();
    const input = screen.getByRole("combobox");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "春天" } });

    expect(await screen.findByText("搜索中…")).toBeInTheDocument();
    expect(screen.queryByText(/没有匹配/)).not.toBeInTheDocument();

    resolveSearch?.({ ok: true, count: 0, results: [] });
    expect(await screen.findByText(/没有匹配「春天」/)).toBeInTheDocument();
  });
});
