import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState, type ReactNode } from "react";
import { useSimilarityGroups } from "../../hooks/useSimilarity";
import { useSimilarityReview } from "./useSimilarityReview";
import { useUIStore } from "../../store/uiStore";
import type { SimilarityGroup } from "../../api/similarity";

vi.mock("../../hooks/useSimilarity", () => ({ useSimilarityGroups: vi.fn() }));
const entries = ["a", "b", "c"].map((id) => ({
  id,
  status: "pending",
  members: [{ resourceId: id + "1" }, { resourceId: id + "2" }],
})) as SimilarityGroup[];
const update = vi.fn(),
  restore = vi.fn(),
  batch = vi.fn(),
  refetch = vi.fn();
function setup(id: string | null) {
  const client = new QueryClient();
  vi.mocked(useSimilarityGroups).mockReturnValue({
    groups: entries,
    update: { mutateAsync: update },
    restore: { mutateAsync: restore },
    batch: { mutateAsync: batch },
    refetch,
    hasNextPage: false,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useSimilarityGroups>);
  return renderHook(
    () => {
      const [groupId, replaceGroupId] = useState(id);
      return useSimilarityReview(
        { status: "pending" },
        { groupId, replaceGroupId },
      );
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  useUIStore.setState({ toasts: [] });
});
describe("逐组审阅", () => {
  it("失效链接回到首组，换组重置成员，支持区间勾选", async () => {
    const { result } = setup("gone");
    await waitFor(() =>
      expect(useUIStore.getState().toasts.at(-1)?.message).toMatch(/不存在/),
    );
    act(() => result.current.setFocus(1));
    expect(result.current.state.focusIndex).toBe(1);
    act(() => result.current.next());
    expect(result.current.state.activeId).toBe("b");
    expect(result.current.state.focusIndex).toBe(0);
    act(() => {
      result.current.toggleChecked("a");
      result.current.toggleChecked("c", true);
    });
    expect([...result.current.state.checked]).toEqual(["a", "b", "c"]);
  });
  it("同组请求只发一次，成功后选中下一组，按原状态撤销", async () => {
    let finish!: () => void;
    update.mockImplementation(
      () =>
        new Promise((done) => {
          finish = () =>
            done({
              changed: true,
              status: "reviewed",
              previousStatus: "pending",
            });
        }),
    );
    const { result } = setup("b");
    let op!: Promise<void>;
    act(() => {
      op = result.current.markReviewed();
      void result.current.markReviewed();
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.state.pending.has("b")).toBe(true);
    await act(async () => {
      finish();
      await op;
    });
    expect(result.current.state.activeId).toBe("c");
    restore.mockResolvedValue({ changed: 1 });
    await act(() => result.current.undo());
    expect(restore).toHaveBeenCalledWith([
      { groupId: "b", from: "reviewed", to: "pending" },
    ]);
    expect(result.current.state.activeId).toBe("b");
  });
  it("失败留在原组并提供重试，浏览别组时迟到的请求不会抢走焦点", async () => {
    update.mockRejectedValueOnce(new Error("offline"));
    const { result } = setup("b");
    await act(() => result.current.ignore());
    expect(result.current.state.activeId).toBe("b");
    const retry = useUIStore.getState().toasts.at(-1)?.action;
    expect(retry?.label).toBe("重试");
    update.mockResolvedValue({
      changed: true,
      previousStatus: "pending",
      status: "ignored",
    });
    await act(async () => {
      result.current.select("a");
      retry?.onClick();
    });
    expect(result.current.state.activeId).toBe("a");
  });
});
