import { expect, it } from "vitest";
import { onThisDayThumbWidth } from "./onThisDay";

describe("那年今日的缩略图尺寸", () => {
  it("按照片自身的比例算宽度", () => {
    // 4:3 的横幅：160 高对应 213 宽。
    expect(onThisDayThumbWidth(4000, 3000)).toBe(213);
    // 3:2：240 宽。
    expect(onThisDayThumbWidth(4500, 3000)).toBe(240);
    // 正方形。
    expect(onThisDayThumbWidth(3000, 3000)).toBe(160);
  });

  it("竖幅窄到下限，不缩成一条缝", () => {
    // 2:3 的竖幅按比例有 107 宽。
    expect(onThisDayThumbWidth(2000, 3000)).toBe(107);
    // 极窄的竖幅不再更窄。
    expect(onThisDayThumbWidth(1000, 4000)).toBe(96);
  });

  it("全景宽到上限，不把一行撑散", () => {
    expect(onThisDayThumbWidth(9000, 3000)).toBe(240);
  });

  it("尺寸未知时按 3:2 兜底，不按方块", () => {
    expect(onThisDayThumbWidth(undefined, undefined)).toBe(240);
    expect(onThisDayThumbWidth(4000, 0)).toBe(240);
    expect(onThisDayThumbWidth(0, 3000)).toBe(240);
  });
});
