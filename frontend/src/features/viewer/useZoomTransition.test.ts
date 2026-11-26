import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { fitRect, flipTransform, useZoomTransition } from "./useZoomTransition";
const viewport = { x: 10, y: 20, width: 200, height: 200 };
it.each([
  [2, 180, 90],
  [0.5, 90, 180],
  [1, 180, 180],
])("按比例 %s 居中保留边距", (ratio, width, height) => {
  expect(fitRect(ratio, viewport, 10)).toEqual({
    x: 10 + (200 - width) / 2,
    y: 20 + (200 - height) / 2,
    width,
    height,
  });
});
it("FLIP 将目标位置缩回来源", () =>
  expect(
    flipTransform(
      { x: 10, y: 20, width: 20, height: 30 },
      { x: 100, y: 80, width: 200, height: 300 },
    ),
  ).toBe("translate(-90px, -60px) scale(0.1, 0.1)"));
it.each([false, true])(
  "源瓦片不可见时执行渐变，减少动态效果 %s",
  async (reducedMotion) => {
    const el = document.createElement("div"),
      animate = vi.spyOn(el, "animate");
    const { result } = renderHook(() =>
      useZoomTransition({ getSourceRect: () => null, reducedMotion }),
    );
    await result.current.enter(el, NaN);
    const [frames, options] = animate.mock.calls[0];
    expect(options).toMatchObject({ duration: reducedMotion ? 150 : 200 });
    expect(frames).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 0 })]),
    );
    if (reducedMotion)
      expect(JSON.stringify(frames)).not.toContain("transform");
  },
);
