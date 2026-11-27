import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useReaderViewport, visiblePages } from "./useReaderViewport";
function rect(top: number, width = 500, height = 500) {
  return new DOMRect(0, top, width, height);
}
it("预渲染行与视口仅接边时不写末页，真正翻屏后才确认", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  Object.defineProperties(root, {
    clientWidth: { value: 500 },
    clientHeight: { value: 500 },
    scrollHeight: { value: 1000 },
  });
  root.getBoundingClientRect = () => rect(0);
  root.scrollTo = vi.fn((arg: ScrollToOptions) => {
    root.scrollTop = arg.top ?? 0;
  }) as typeof root.scrollTo;
  for (const i of [5, 6, 7]) {
    const img = document.createElement("img");
    img.dataset.readerPage = String(i);
    Object.defineProperties(img, {
      complete: { value: true },
      naturalWidth: { value: 500 },
    });
    img.getBoundingClientRect = () => rect((i - 6) * 500 - root.scrollTop);
    root.append(img);
  }
  const onObserve = vi.fn(),
    scrollToIndex = vi.fn();
  const images = Array.from({ length: 8 }, (_, i) => String(i));
  const { result, unmount } = renderHook(() =>
    useReaderViewport({
      albumId: "a",
      images,
      index: 6,
      mode: "continuous",
      rotation: 0,
      layoutKey: "1",
      request: { epoch: 9, index: 6, source: "key" },
      virtuoso: { current: { scrollToIndex } as never },
      onObserve,
    }),
  );
  act(() => result.current.setScroller(root));
  await waitFor(() =>
    expect(onObserve).toHaveBeenCalledWith(
      expect.objectContaining({ first: 6, last: 6, epoch: 9 }),
    ),
  );
  onObserve.mockClear();
  act(() => {
    result.current.scrollScreen(1);
    result.current.schedule();
    result.current.schedule();
  });
  await waitFor(() => expect(onObserve).toHaveBeenCalledTimes(1));
  expect(root.scrollTop).toBe(450);
  expect(onObserve).toHaveBeenCalledWith(
    expect.objectContaining({ first: 6, last: 7 }),
  );
  expect(scrollToIndex).not.toHaveBeenCalled();
  unmount();
  onObserve.mockClear();
  root.dispatchEvent(new Event("scroll"));
  await new Promise(requestAnimationFrame);
  expect(onObserve).not.toHaveBeenCalled();
  root.remove();
});
it("零高视口、坏图和横向完全不可见的页均排除", () => {
  const root = document.createElement("div"),
    img = document.createElement("img");
  img.dataset.readerPage = "0";
  root.append(img);
  root.getBoundingClientRect = () => rect(0);
  img.getBoundingClientRect = () => rect(0);
  expect(visiblePages(root).pages).toHaveLength(0);
  Object.defineProperties(img, {
    complete: { value: true },
    naturalWidth: { value: 1 },
  });
  img.getBoundingClientRect = () => new DOMRect(500, 0, 100, 100);
  expect(visiblePages(root).pages).toHaveLength(0);
  root.getBoundingClientRect = () => rect(0, 500, 0);
  expect(visiblePages(root).pages).toHaveLength(0);
});
