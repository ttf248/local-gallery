import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressEvent } from "../api/scan";
import { useScanStore } from "../store/scanStore";
import { useScanSSE } from "./useScanSSE";

const sseMock = vi.hoisted(() => ({
  onEvent: null as ((eventName: string, data: unknown) => void) | null,
}));

vi.mock("../api/client", () => ({
  sse: vi.fn(
    (_path: string, onEvent: (eventName: string, data: unknown) => void) => {
      sseMock.onEvent = onEvent;
      return vi.fn();
    },
  ),
}));

describe("useScanSSE", () => {
  beforeEach(() => {
    act(() => useScanStore.getState().clear());
    sseMock.onEvent = null;
  });

  it("保留终态直到显式 reset", () => {
    const { result, unmount } = renderHook(() => useScanSSE());

    act(() => result.current.startWith("scan-1"));
    expect(sseMock.onEvent).not.toBeNull();

    const complete: ProgressEvent = {
      scanId: "scan-1",
      progress: 1,
      status: "complete",
      albumsFound: 12,
      elapsedMs: 350,
    };
    act(() => sseMock.onEvent?.("complete", complete));

    expect(result.current.scanId).toBe("scan-1");
    expect(result.current.progress).toEqual(complete);
    expect(result.current.isComplete).toBe(true);

    unmount();
    expect(useScanStore.getState().progress).toEqual(complete);

    act(() => useScanStore.getState().clear());
    expect(useScanStore.getState().progress).toBeNull();
  });
});
