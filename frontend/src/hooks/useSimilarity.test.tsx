import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { similarityApi } from "../api/similarity";
import { picksQueryKey } from "./usePicks";
import {
  similarityGroupsQueryKey,
  similarityStatusKey,
  useSimilarityGroups,
} from "./useSimilarity";

vi.mock("../api/similarity", () => ({
  similarityApi: {
    groups: vi.fn(),
    update: vi.fn(),
    batch: vi.fn(),
    rebuild: vi.fn(),
    status: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(similarityApi.groups).mockResolvedValue({
    ok: true,
    page: {
      revision: 1,
      total: 0,
      groups: [],
      folders: [],
      summary: {
        exact: 0,
        near: 0,
        burst: 0,
        pending: 0,
        reviewed: 0,
        ignored: 0,
        photos: 0,
        redundant: 0,
      },
      stale: false,
      limited: false,
    },
  });
  vi.mocked(similarityApi.update).mockResolvedValue({ ok: true });
  vi.mocked(similarityApi.batch).mockResolvedValue({ ok: true, changed: 1 });
  vi.mocked(similarityApi.rebuild).mockResolvedValue({
    ok: true,
    summary: {
      exact: 0,
      near: 0,
      burst: 0,
      pending: 0,
      reviewed: 0,
      ignored: 0,
      photos: 0,
      redundant: 0,
    },
  });
});

function setup(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useSimilarityGroups(), { wrapper });
  return { ...hook, client };
}

it("更新代表或审查决定后失效全部相似分组页与状态", async () => {
  const { result, client } = setup();
  client.setQueryData(similarityGroupsQueryKey({ kind: "exact" }), {
    ok: true,
    pages: [],
    pageParams: [],
  });
  client.setQueryData(similarityStatusKey, { ok: true, status: {} });

  for (const body of [
    { representative: "f_2" },
    { reviewed: true },
    { ignored: true },
  ]) {
    await act(async () => {
      await result.current.update.mutateAsync({ id: "g_1", body });
    });
  }

  await waitFor(() =>
    expect(
      client.getQueryState(similarityGroupsQueryKey({ kind: "exact" }))
        ?.isInvalidated,
    ).toBe(true),
  );
  expect(client.getQueryState(similarityStatusKey)?.isInvalidated).toBe(true);
  expect(similarityApi.update).toHaveBeenCalledTimes(3);
});

it("把相似组代表加入精选后失效精选集合和照片页缓存", async () => {
  const { result, client } = setup();
  client.setQueryData(picksQueryKey, { picks: [], total: 0, revision: 1 });
  client.setQueryData(["picks", "media"], {
    pages: [{ revision: 1, items: [], total: 0 }],
    pageParams: [undefined],
  });
  client.setQueryData(similarityStatusKey, { ok: true, status: {} });

  await act(async () => {
    await result.current.batch.mutateAsync({
      action: "pick",
      groupIds: ["g_1"],
    });
  });

  expect(client.getQueryState(picksQueryKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(["picks", "media"])?.isInvalidated).toBe(true);
  expect(client.getQueryState(similarityStatusKey)?.isInvalidated).toBe(true);
});
