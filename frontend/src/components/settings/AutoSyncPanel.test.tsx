import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import {
  librarySyncApi,
  type LibrarySyncStatus,
} from "../../api/librarySync";
import AutoSyncPanel from "./AutoSyncPanel";

vi.mock("../../api/librarySync", async (original) => ({
  ...(await original<typeof import("../../api/librarySync")>()),
  librarySyncApi: { status: vi.fn(), update: vi.fn() },
}));

const status: LibrarySyncStatus = {
  enabled: true,
  autoAnalyze: false,
  running: true,
  degraded: false,
  watchedRoots: 1,
  watchedDirs: 12,
  maxWatchDirs: 10000,
  pendingChanges: 0,
  pendingAnalysis: 0,
  lastDetected: 7,
  lastUpdated: 3,
  lastFailed: 0,
  libraryRevision: 42,
  lastVerifyAt: "2026-11-18T03:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(librarySyncApi.status).mockResolvedValue(status);
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AutoSyncPanel />
    </QueryClientProvider>,
  );
  return client;
}

it("显示监听状态与最近一次同步的结果", async () => {
  setup();
  expect(await screen.findByText("正在监听媒体目录")).toBeTruthy();
  expect(screen.getByText("7 项")).toBeTruthy();
  expect(screen.getByText("3 项")).toBeTruthy();
  expect(screen.getByText("12 / 10000")).toBeTruthy();
});

it("打开自动发现文件变化会提交开关", async () => {
  vi.mocked(librarySyncApi.update).mockResolvedValue({
    ...status,
    enabled: false,
  });
  setup();
  await screen.findByText("正在监听媒体目录");
  const toggle = screen.getByRole("switch", { name: "自动发现文件变化" });
  fireEvent.click(toggle);
  await waitFor(() => {
    expect(librarySyncApi.update).toHaveBeenCalledWith({ enabled: false });
  });
});

it("关闭监听后不能打开自动分析", async () => {
  vi.mocked(librarySyncApi.status).mockResolvedValue({
    ...status,
    enabled: false,
  });
  setup();
  await screen.findByText("已关闭，文件变化不会自动更新图库");
  const toggle = screen.getByRole("switch", { name: "变化后自动分析" });
  expect((toggle as HTMLButtonElement).disabled).toBe(true);
});

it("监听降级时说明改用定期校验", async () => {
  vi.mocked(librarySyncApi.status).mockResolvedValue({
    ...status,
    degraded: true,
  });
  setup();
  expect(
    await screen.findByText("监听不稳定，已改用定期校验兜底"),
  ).toBeTruthy();
});

it("失败原因翻译成中文", async () => {
  vi.mocked(librarySyncApi.status).mockResolvedValue({
    ...status,
    lastError: "event_overflow",
  });
  setup();
  expect(
    await screen.findByText("文件事件溢出，已改用定期校验"),
  ).toBeTruthy();
});
