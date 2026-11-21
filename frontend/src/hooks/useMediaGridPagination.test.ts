import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMediaGridPagination } from "./useMediaGridPagination";

function options() {
  return {
    loadedCount: 200,
    hasNextPage: true,
    isLoadingMore: false,
    loadMoreError: false,
    onLoadMore: vi.fn(),
  };
}

describe("useMediaGridPagination", () => {
  it("首屏不预载整本，接近已加载边界后取下一页", () => {
    const props = options();
    const { result } = renderHook(() => useMediaGridPagination(props));
    expect(props.onLoadMore).not.toHaveBeenCalled();

    act(() => result.current({ startIndex: 0, endIndex: 35 }));
    expect(props.onLoadMore).not.toHaveBeenCalled();

    act(() => result.current({ startIndex: 160, endIndex: 190 }));
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("跳入远处占位区后逐页补齐，无需再次滚动", () => {
    const props = options();
    const { result, rerender } = renderHook(useMediaGridPagination, {
      initialProps: props,
    });
    act(() => result.current({ startIndex: 550, endIndex: 580 }));
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);

    rerender({ ...props, isLoadingMore: true });
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
    rerender({ ...props, loadedCount: 400 });
    expect(props.onLoadMore).toHaveBeenCalledTimes(2);
    rerender({ ...props, loadedCount: 600 });
    expect(props.onLoadMore).toHaveBeenCalledTimes(3);
    rerender({ ...props, loadedCount: 800 });
    expect(props.onLoadMore).toHaveBeenCalledTimes(3);
  });

  it("取下一页的回调换了身份也不会多取一次", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(useMediaGridPagination, {
      initialProps: {
        loadedCount: 200,
        hasNextPage: true,
        isLoadingMore: false,
        onLoadMore: first,
      },
    });
    act(() => result.current({ startIndex: 160, endIndex: 190 }));
    expect(first).toHaveBeenCalledTimes(1);

    // 调用方给的多半是内联箭头函数：身份每次渲染都换。
    // 换了身份不该再取一次 —— 条件没变，就不该动。
    rerender({
      loadedCount: 200,
      hasNextPage: true,
      isLoadingMore: false,
      onLoadMore: second,
    });
    expect(second).not.toHaveBeenCalled();
  });

  it("加载期间和禁止继续分页时不发请求，恢复后重新检查视口", () => {
    const props = options();
    const { result, rerender } = renderHook(useMediaGridPagination, {
      initialProps: { ...props, isLoadingMore: true },
    });
    act(() => result.current({ startIndex: 200, endIndex: 230 }));
    expect(props.onLoadMore).not.toHaveBeenCalled();

    rerender({ ...props, hasNextPage: false });
    act(() => result.current({ startIndex: 400, endIndex: 430 }));
    expect(props.onLoadMore).not.toHaveBeenCalled();

    rerender(props);
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
  });

  // 失败之后自动续页会变成一条无限请求：条件（已到末尾、还有下一页）
  // 一直成立，失败一次接一次。
  it("取下一页失败后不再自动续页，重试交给用户", () => {
    const props = options();
    const { result, rerender } = renderHook(useMediaGridPagination, {
      initialProps: props,
    });
    act(() => result.current({ startIndex: 160, endIndex: 190 }));
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);

    // 这一页失败了。
    rerender({ ...props, isLoadingMore: true });
    rerender({ ...props, loadMoreError: true });

    // 条件仍然成立，但失败状态不再自动触发。
    act(() => result.current({ startIndex: 160, endIndex: 190 }));
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);

    // 用户重试成功后，自动续页恢复。
    rerender({ ...props, loadMoreError: false });
    expect(props.onLoadMore).toHaveBeenCalledTimes(2);
  });
});
