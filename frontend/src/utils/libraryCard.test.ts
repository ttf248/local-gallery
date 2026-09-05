import { describe, expect, it } from "vitest";
import type { LibraryNodeSummary, LibraryTagSummary } from "../api/library";
import { libraryOverviewCards, nodeSummaryToCard } from "./libraryCard";

function node(
  id: string,
  kind: LibraryNodeSummary["kind"],
  extra: Partial<LibraryNodeSummary> = {},
): LibraryNodeSummary {
  return {
    id,
    kind,
    name: id,
    displayName: id,
    coverImages: [],
    ...extra,
  };
}

describe("libraryCard", () => {
  it("集合卡片使用聚合数量与拼贴封面", () => {
    const card = nodeSummaryToCard(
      node("c_year", "collection", {
        albumCount: 12,
        coverImage: "f_cover",
        coverImages: ["f_cover", "f_second"],
      }),
    );

    expect(card.count).toBe(12);
    expect(card.coverPath).toBe("f_cover");
    expect(card.covers).toEqual(["f_cover", "f_second"]);
  });

  it("首页隐藏虚拟相册并追加标签卡片", () => {
    const tags: LibraryTagSummary[] = [
      {
        tag: "旅行",
        albumCount: 3,
        coverImage: "f_tag",
        coverImages: ["f_tag"],
      },
    ];
    const cards = libraryOverviewCards(
      [
        node("a_loose", "album", { virtual: true }),
        node("c_root", "collection", { albumCount: 1 }),
      ],
      tags,
    );

    expect(cards.map((card) => card.id)).toEqual(["c:c_root", "s:旅行"]);
  });
});
