import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SmartAlbumRefreshPanel from "./SmartAlbumRefreshPanel";
import { albumsApi } from "../../api/albums";
import { useSmartAlbumRefreshStore } from "../../store/smartAlbumRefreshStore";

const sseMock = vi.hoisted(() => vi.fn());

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return { ...actual, sse: sseMock };
});

vi.mock("../../api/albums", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/albums")>();
  return {
    ...actual,
    albumsApi: {
      ...actual.albumsApi,
      startSmartAlbumRefresh: vi.fn(),
      smartAlbumRefreshActive: vi.fn(),
      cancelSmartAlbumRefresh: vi.fn(),
    },
  };
});

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SmartAlbumRefreshPanel />
    </QueryClientProvider>,
  );
}

describe("SmartAlbumRefreshPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseMock.mockReturnValue(() => {});
    useSmartAlbumRefreshStore.setState({ jobId: null, progress: null });
    vi.mocked(albumsApi.smartAlbumRefreshActive).mockRejectedValue(
      new Error("no task"),
    );
    vi.mocked(albumsApi.startSmartAlbumRefresh).mockResolvedValue({
      ok: true,
      jobId: "job-1",
      reused: false,
    });
    vi.mocked(albumsApi.cancelSmartAlbumRefresh).mockResolvedValue({ ok: true });
  });

  it("增量更新只重建有变化的相册", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "增量更新" }));

    await waitFor(() =>
      expect(albumsApi.startSmartAlbumRefresh).toHaveBeenCalledWith(false),
    );
  });

  it("强制重建无视缓存全部重算", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "强制重建" }));

    await waitFor(() =>
      expect(albumsApi.startSmartAlbumRefresh).toHaveBeenCalledWith(true),
    );
  });

  it("运行中显示进度并能取消", async () => {
    useSmartAlbumRefreshStore.setState({
      jobId: "job-1",
      progress: {
        jobId: "job-1",
        status: "running",
        force: false,
        albums: 3,
        total: 12,
        done: 5,
        rebuilt: 5,
        reused: 0,
        groups: 9,
        currentAlbumName: "旅行",
        currentDimension: "time",
        elapsedMs: 4000,
      },
    });
    renderPanel();

    expect(screen.getByTestId("smart-album-refresh-progress")).toBeVisible();
    expect(screen.getByText(/正在生成 5 \/ 12/)).toBeVisible();
    expect(screen.getByText(/旅行 · 时间/)).toBeVisible();
    // 生成中时不能再启动一次。
    expect(screen.getByRole("button", { name: "生成中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "强制重建" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() =>
      expect(albumsApi.cancelSmartAlbumRefresh).toHaveBeenCalledWith("job-1"),
    );
  });

  it("完成后给出重算与复用的数量", () => {
    useSmartAlbumRefreshStore.setState({
      jobId: "job-1",
      progress: {
        jobId: "job-1",
        status: "complete",
        force: false,
        albums: 3,
        total: 12,
        done: 12,
        rebuilt: 4,
        reused: 8,
        groups: 21,
        elapsedMs: 9000,
      },
    });
    renderPanel();

    expect(screen.getByTestId("smart-album-refresh-done")).toHaveTextContent(
      "重算 4 · 复用 8 · 21 个分组",
    );
  });
});
