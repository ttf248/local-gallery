import { expect, it } from "vitest";
import type { LibraryFeedItem } from "../../api/library";
import { groupMemoriesByYear } from "./memories";
const today = new Date(2026, 10, 27);
function item(
  id: string,
  dateValue?: string,
  width = 100,
  height = 200,
): LibraryFeedItem {
  return {
    id,
    dateValue,
    width,
    height,
    kind: "image",
    name: id,
    albumId: "a1",
    albumName: "家",
    index: 0,
    kindIndex: 0,
  };
}
it("分年降序，组内升序，横图优先；忽略今年、未来和缺失日期", () => {
  const portrait = item("a", "2024-11-27"),
    landscape = item("b", "2024-11-26", 300, 200),
    old = item("c", "2019-11-27");
  const groups = groupMemoriesByYear(
    [
      portrait,
      item("x", "2026-11-27"),
      old,
      landscape,
      item("future", "2028-11-27"),
      item("bad"),
    ],
    today,
  );
  expect(groups.map((g) => g.year)).toEqual([2024, 2019]);
  expect(groups[0]).toMatchObject({
    yearsAgo: 2,
    label: "2 年前",
    items: [landscape, portrait],
    cover: landscape,
  });
  expect(groups[1].cover).toBe(old);
  expect(groupMemoriesByYear([], today)).toEqual([]);
});
