import { describe, expect, it } from "vitest";
import { packSections, type SectionInput } from "./sectionPacking";
const options = { containerWidth: 1000, targetHeight: 100, gap: 4 };
function section(key: string, count: number, ratio = 1): SectionInput {
  return {
    key,
    year: key.split("-")[0],
    tiles: Array.from({ length: count }, (_, i) => ({
      id: key + ":" + i,
      ratio,
    })),
  };
}
const a = section("2024-12", 2),
  b = section("2024-11", 2);
describe("月份拼排", () => {
  it("空输入", () => expect(packSections([], options)).toEqual([]));
  it("宽度为零", () =>
    expect(packSections([a], { ...options, containerWidth: 0 })).toEqual([]));
  it("单月保留标题和行", () =>
    expect(packSections([a], options).map((x) => x.kind)).toEqual([
      "header",
      "row",
    ]));
  it("相邻同年月份保留各自标题与自然宽度", () =>
    expect(packSections([a, b], options)).toMatchObject([
      {
        kind: "inline",
        segments: [
          { key: a.key, x: 0, width: 204 },
          { key: b.key, x: 236, width: 204 },
        ],
      },
    ]));
  it.each([
    ["跨年", a, section("2023-12", 1)],
    ["日期未知", section("unknown-1", 1), section("unknown", 1)],
    ["超过六张", a, section("2024-10", 7, 0.4)],
    ["超过六成宽度", a, section("2024-10", 3, 2)],
  ] as const)("%s 单独成段", (_, first, second) =>
    expect(
      packSections([first, second], options).some((x) => x.kind === "inline"),
    ).toBe(false),
  );
  it("累计超宽时换行", () =>
    expect(
      packSections([a, b, section("2024-10", 4, 1.4)], options).map(
        (x) => x.kind,
      ),
    ).toEqual(["inline", "header", "row"]));
  it("窄屏独立成段", () =>
    expect(
      packSections([a, b], { ...options, containerWidth: 639 }),
    ).toHaveLength(4));
  it("异常比例回退，有限比例钳制", () => {
    const sections = [
      section("2024-04", 1, 0),
      section("2024-03", 1, NaN),
      section("2024-02", 1, Infinity),
      section("2024-01", 1, 0.01),
    ];
    const band = packSections(sections, options)[0];
    expect(band.kind).toBe("inline");
    if (band.kind === "inline") {
      expect(
        band.segments.every((s) => Number.isFinite(s.width) && s.width > 0),
      ).toBe(true);
      expect(band.segments.at(-1)?.width).toBe(40);
    }
  });
  it("重复计算生成稳定键", () =>
    expect(packSections([a, b], options)).toEqual(
      packSections([a, b], options),
    ));
});
