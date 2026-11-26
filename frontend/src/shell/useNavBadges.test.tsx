import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { similarityStatusKey } from "../api/queryKeys";
import { useNavBadges } from "./useNavBadges";

const { activity, status } = vi.hoisted(() => ({
  activity: vi.fn(),
  status: vi.fn(),
}));
vi.mock("../hooks/useLibrary", () => ({ useLibraryActivitySummary: activity }));
vi.mock("../api/similarity", () => ({ similarityApi: { status } }));

function badges(mode: "photo" | "comic", cachedPending?: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (cachedPending !== undefined) {
    client.setQueryData(
      similarityStatusKey,
      { status: { summary: { pending: cachedPending } } },
      { updatedAt: 1 },
    );
  }
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(({ mode }) => useNavBadges(mode), {
      wrapper,
      initialProps: { mode },
    }),
    client,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  activity.mockReturnValue({ data: { summary: { unreadCount: 0 } } });
});

it("查询失败时不显示过期的待整理数", async () => {
  status.mockRejectedValue(new Error("离线"));
  const { result, client } = badges("photo", 12);
  await waitFor(() =>
    expect(client.getQueryState(similarityStatusKey)?.status).toBe("error"),
  );
  expect(result.current).toEqual({});
});

it.each([0, 12])("仅展示非零待整理数 %i", async (pending) => {
  status.mockResolvedValue({ status: { summary: { pending } } });
  const { result, client } = badges("photo");
  await waitFor(() =>
    expect(client.getQueryState(similarityStatusKey)?.status).toBe("success"),
  );
  await waitFor(() =>
    expect(result.current).toEqual(
      pending ? { "photo.organize": pending } : {},
    ),
  );
});

it("漫画侧只使用未读数，零张时留空", () => {
  const { result, rerender } = badges("comic");
  expect(result.current).toEqual({});
  activity.mockReturnValue({ data: { summary: { unreadCount: 8 } } });
  rerender({ mode: "comic" });
  expect(result.current).toEqual({ "comic.unread": 8 });
  expect(status).not.toHaveBeenCalled();
  status.mockResolvedValue({ status: { summary: { pending: 12 } } });
  rerender({ mode: "photo" });
  return waitFor(() =>
    expect(result.current).toEqual({ "photo.organize": 12 }),
  );
});
