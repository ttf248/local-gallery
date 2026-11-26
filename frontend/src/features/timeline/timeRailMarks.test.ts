import { expect, it } from "vitest";
import { buildTimeRailMarks, markAtFraction } from "./timeRailMarks";
const years = [
  { year: 2024, count: 90, months: [{ month: 6, count: 90 }] },
  { year: 2023, count: 10 },
];
it("按数量分配跨度，稀疏年份仍有最小宽度", () => {
  const marks = buildTimeRailMarks(years, 4);
  expect(marks.map((m) => m.key)).toEqual([
    "2024",
    "2024-06",
    "2023",
    "unknown",
  ]);
  expect(marks[2].fraction).toBeCloseTo(0.02 + 0.92 * 0.9);
  expect(marks.at(-1)?.fraction).toBe(1);
  expect(buildTimeRailMarks(years, 0, { railHeight: 479 })).toHaveLength(2);
  expect(buildTimeRailMarks(years.slice(0, 1), 0)).toEqual([]);
});
it("二分定位边界与中点", () => {
  const marks = buildTimeRailMarks(years, 4);
  expect(markAtFraction([], 0)).toBeNull();
  expect(markAtFraction(marks, 0)).toBe(marks[0]);
  expect(markAtFraction(marks, 1)).toBe(marks.at(-1));
  expect(markAtFraction(marks, marks[1].fraction / 2)).toBe(marks[0]);
});
