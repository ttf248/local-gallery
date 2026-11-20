import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { libraryApi } from "../api/library";
import { useAlbumFilters } from "./useLibrary";

afterEach(() => {
  vi.restoreAllMocks();
});

it("does not fetch while disabled and reuses fresh cached facets", async () => {
  const response = {
    ok: true,
    revision: 1,
    facets: {
      total: 0,
      videos: 0,
      time: {
        available: false,
        reason: "尚未分析",
        months: [],
        analyzedCount: 0,
        unresolvedCount: 0,
      },
      people: {
        available: false,
        reason: "尚未分析",
        items: [],
        analyzedCount: 0,
      },
      places: {
        available: false,
        reason: "尚未分析",
        items: [],
        locatedCount: 0,
      },
      picks: { pickedCount: 0 },
      groupPhotos: { available: false, reason: "尚未分析", count: 0 },
      similarity: {
        available: false,
        reason: "尚未分析",
        groupCount: 0,
        photoCount: 0,
        stale: false,
      },
    },
  } as Awaited<ReturnType<typeof libraryApi.albumFilters>>;
  const albumFilters = vi
    .spyOn(libraryApi, "albumFilters")
    .mockResolvedValue(response);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, rerender } = renderHook(
    ({ enabled }) => useAlbumFilters("a_1", enabled),
    { initialProps: { enabled: false }, wrapper },
  );

  expect(albumFilters).not.toHaveBeenCalled();

  rerender({ enabled: true });
  await waitFor(() => expect(result.current.data).toEqual(response));
  expect(albumFilters).toHaveBeenCalledTimes(1);

  act(() => {
    rerender({ enabled: false });
    rerender({ enabled: true });
  });
  await waitFor(() => expect(result.current.data).toEqual(response));
  expect(albumFilters).toHaveBeenCalledTimes(1);
});
