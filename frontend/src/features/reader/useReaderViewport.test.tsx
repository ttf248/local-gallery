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
  Object.defineProperties(root, {
    clientWidth: { value: 500 },
    clientHeight: { configurable: true, value: 500 },
  });
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
  Object.defineProperty(root, "clientHeight", { value: 0 });
  root.getBoundingClientRect = () => rect(0, 500, 0);
  expect(visiblePages(root).pages).toHaveLength(0);
});

it("旋转后把指针锚点留在原位置，并拒绝上一版式的回锚", async () => {
  const root = document.createElement("div"),
    page = document.createElement("img");
  document.body.append(root);
  root.append(page);
  page.dataset.readerPage = "0";
  root.getBoundingClientRect = () => rect(0);
  Object.defineProperties(root, {
    clientWidth: { value: 500 },
    clientHeight: { value: 500 },
  });
  Object.defineProperties(page, {
    complete: { value: true },
    naturalWidth: { value: 900 },
  });
  let rotation = 0;
  page.getBoundingClientRect = () =>
    new DOMRect(
      -root.scrollLeft,
      -root.scrollTop,
      rotation ? 1200 : 900,
      rotation ? 900 : 1200,
    );
  const images = ["a"],
    request = { index: 0, epoch: 7, source: "key" as const },
    onObserve = vi.fn();
  let generation = 7;
  const view = renderHook(
    ({ angle }) =>
      useReaderViewport({
        albumId: "volume",
        images,
        index: 0,
        mode: "single",
        request,
        rotation: angle,
        layoutKey: String(angle),
        virtuoso: { current: null },
        onObserve,
        onInvalidate: () => ++generation,
      }),
    { initialProps: { angle: 0 } },
  );
  act(() => view.result.current.setScroller(root));
  await waitFor(() => expect(onObserve).toHaveBeenCalled());
  root.scrollTop = 300;
  const anchor = view.result.current.captureAnchor({
    clientX: 250,
    clientY: 150,
  })!;
  const previous = generation;
  expect(anchor.u).toBeCloseTo(250 / 900);
  expect(anchor.v).toBeCloseTo(450 / 1200);
  rotation = 90;
  view.rerender({ angle: 90 });
  await waitFor(() =>
    expect(onObserve.mock.lastCall?.[0].epoch).toBeGreaterThan(previous),
  );
  expect(root.scrollLeft).toBeCloseTo(500);
  expect(root.scrollTop).toBeCloseTo(100);
  view.result.current.restoreAnchor({ ...anchor, u: 0, v: 0 }, previous);
  await new Promise(requestAnimationFrame);
  expect(root.scrollTop).toBeCloseTo(100);
  view.unmount();
  root.remove();
});

it("卷内文件换序后跟随同一页和页内位置，文件移除后定位到剩余末页", async () => {
  const root = document.createElement("div");
  const img = document.createElement("img");
  root.append(img);
  document.body.append(root);
  Object.defineProperties(root, {
    clientWidth: { value: 500 },
    clientHeight: { value: 500 },
  });
  Object.defineProperties(img, {
    complete: { value: true },
    naturalWidth: { value: 500 },
  });
  root.getBoundingClientRect = () => rect(0);
  img.getBoundingClientRect = () => rect(-root.scrollTop, 500, 1200);
  let logicalIndex = 1;
  let epoch = 0;
  img.dataset.readerPage = String(logicalIndex);
  const observe = vi.fn();
  const view = renderHook(
    ({ images }) =>
      useReaderViewport({
        albumId: "volume",
        images,
        index: logicalIndex,
        mode: "single",
        rotation: 0,
        layoutKey: "single",
        request: { index: 1, epoch: 1, source: "key" },
        virtuoso: { current: null },
        onObserve: observe,
        onInvalidate: (_request, _relayout, reindexedTarget) => {
          if (reindexedTarget !== undefined) {
            logicalIndex = reindexedTarget;
            img.dataset.readerPage = String(logicalIndex);
          }
          return ++epoch;
        },
      }),
    { initialProps: { images: ["a", "b", "c"] } },
  );
  act(() => view.result.current.setScroller(root));
  await waitFor(() =>
    expect(observe.mock.lastCall?.[0].anchor.fileId).toBe("b"),
  );
  root.scrollTop = 200;
  view.result.current.captureAnchor();
  root.scrollTop = 0;
  view.rerender({ images: ["c", "a", "b"] });
  await waitFor(() => expect(observe.mock.lastCall?.[0].first).toBe(2));
  expect(observe.mock.lastCall?.[0].anchor.fileId).toBe("b");
  expect(root.scrollTop).toBeCloseTo(200);
  view.rerender({ images: ["c"] });
  await waitFor(() =>
    expect(observe.mock.lastCall?.[0].anchor.fileId).toBe("c"),
  );
  expect(logicalIndex).toBe(0);
  expect(root.scrollTop).toBe(0);
  view.unmount();
  root.remove();
});
