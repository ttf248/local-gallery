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
