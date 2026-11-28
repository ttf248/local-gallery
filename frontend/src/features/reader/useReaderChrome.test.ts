import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useReaderChrome } from "./useReaderChrome";
it("中央显隐、边缘唤醒、焦点与抽屉保护，卸载释放定时器", () => {
  vi.useFakeTimers();
  try {
    const { result, rerender, unmount } = renderHook(
      ({ lockedOpen }) =>
        useReaderChrome({ autoHide: true, lockedOpen, idleMs: 50 }),
      { initialProps: { lockedOpen: false } },
    );
    act(() => result.current.toggle());
    expect(result.current.visible).toBe(false);
    act(() => result.current.notifyEdgeActivity(10, 900));
    expect(result.current.visible).toBe(true);
    act(() => result.current.chromeFocusProps.onFocusCapture());
    act(() => vi.advanceTimersByTime(80));
    expect(result.current.visible).toBe(true);
    rerender({ lockedOpen: true });
    act(() => result.current.hide());
    expect(result.current.visible).toBe(true);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
