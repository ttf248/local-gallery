import { describe, it, expect } from "vitest";
import { spreadAt, clampPage } from "./readerLayout";
describe("跨页配对", () => {
  it("只按逻辑页序配对，处理单双数末页和异常定位", () => {
    expect(spreadAt(5, 8)).toEqual([4, 5]);
    expect(spreadAt(7, 8)).toEqual([6, 7]);
    expect(spreadAt(40, 9)).toEqual([8]);
    expect(spreadAt(0, 1)).toEqual([0]);
    expect(spreadAt(0, 0)).toEqual([]);
    expect(clampPage(NaN, 8)).toBe(0);
    expect(clampPage(-3, 8)).toBe(0);
    expect(clampPage(3.9, 8)).toBe(3);
  });
});

import { nextSpreadIndex, prevSpreadIndex } from "./readerLayout";
it("翻到跨页扫描图时独占一屏，前后翻页访问相同的页组", () => {
  const wide = [false, false, false, true, false, false];
  expect(spreadAt(2, 6, true, wide)).toEqual([1, 2]);
  expect(nextSpreadIndex(1, 6, true, wide)).toBe(3);
  expect(spreadAt(3, 6, true, wide)).toEqual([3]);
  expect(nextSpreadIndex(3, 6, true, wide)).toBe(4);
  expect(prevSpreadIndex(4, 6, true, wide)).toBe(3);
  expect(spreadAt(5, 6, true, wide)).toEqual([4, 5]);
  expect(spreadAt(2, 6, false, wide)).toEqual([2]);
});
for (const total of [0, 1, 2, 3, 10])
  for (const offset of [false, true])
    it(`覆盖 ${total} 页偏移 ${offset}`, () => {
      const pages: number[] = [];
      let first = 0;
      while (first < total) {
        const spread = spreadAt(first, total, offset);
        pages.push(...spread);
        if (spread.at(-1) === total - 1) break;
        const next = nextSpreadIndex(first, total, offset);
        expect(prevSpreadIndex(next, total, offset)).toBe(first);
        first = next;
      }
      expect(pages).toEqual(Array.from({ length: total }, (_, i) => i));
      if (total && offset) expect(spreadAt(0, total, true)).toEqual([0]);
    });
import { layoutPages, type LayoutInput } from "./readerLayout";
for (const mode of ["single", "continuous", "double"] as const)
  for (const fit of ["fit", "width", "height", "original"] as const) {
    it(`${mode} / ${fit} 各角度与倍率都等比且占位准确`, () => {
      for (const size of [
        [900, 1462],
        [900, 697],
        [900, 1350],
        [240, 320],
        [400, 2800],
      ])
        for (const rotation of [0, 90, 180, 270] as const)
          for (const zoom of [0.1, 1, 1.2, 5]) {
            const input: LayoutInput = {
              mode,
              fit,
              direction: "rtl",
              rotation,
              zoom,
              gap: 4,
              viewport: { width: 390, height: 740 },
              pages: [
                {
                  index: 0,
                  fileId: "a",
                  source: { width: size[0], height: size[1] },
                },
              ],
            };
            if (mode === "double")
              input.pages = [
                ...input.pages,
                { index: 1, fileId: "b", source: { width: 800, height: 620 } },
              ];
            const { boxes, extent } = layoutPages(input);
            for (const b of boxes) {
              const source = input.pages[b.index].source;
              expect(b.imageWidth / b.imageHeight).toBeCloseTo(
                source.width / source.height,
              );
              expect(b.width).toBe(
                rotation % 180 ? b.imageHeight : b.imageWidth,
              );
              expect(b.height).toBe(
                rotation % 180 ? b.imageWidth : b.imageHeight,
              );
              if (fit === "original")
                expect(b.imageWidth).toBeCloseTo(source.width * zoom);
              expect(b.x).toBeGreaterThanOrEqual(-1e-8);
              expect(b.y + b.height).toBeLessThanOrEqual(extent.height + 1e-8);
              if (fit === "fit" && zoom === 1) {
                expect(b.width).toBeLessThanOrEqual(390.001);
                expect(b.height).toBeLessThanOrEqual(740.001);
              }
            }
            if (fit === "height")
              expect(Math.max(...boxes.map((b) => b.height))).toBeCloseTo(
                740 * zoom,
              );
            if (boxes.length === 2) {
              expect(boxes[0].index).toBe(1);
              expect(boxes[1].x - boxes[0].x - boxes[0].width).toBeCloseTo(4);
            }
          }
    });
  }
it("无页与无效视口返回空占位", () => {
  const input: LayoutInput = {
    viewport: { width: NaN, height: 0 },
    pages: [],
    mode: "single",
    fit: "fit",
    direction: "rtl",
    rotation: 0,
    zoom: NaN,
    gap: 4,
  };
  expect(layoutPages(input)).toEqual({
    extent: { width: 0, height: 0 },
    boxes: [],
  });
});
