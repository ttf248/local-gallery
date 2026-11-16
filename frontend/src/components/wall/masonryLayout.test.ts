import { describe, expect, it } from "vitest";
import { layoutMasonry } from "./masonryLayout";

describe("瀑布流排布", () => {
  it("按容器宽度定列数，剩下的宽度均分给各列", () => {
    const layout = layoutMasonry(
      [
        { id: "a", ratio: 1.5 },
        { id: "b", ratio: 0.75 },
      ],
      { containerWidth: 1000, targetColumnWidth: 250, gap: 10 },
    );
    // (1000 + 10) / (250 + 10) = 3.88 → 三列。
    expect(layout.columns).toBe(3);
    // 列宽 = (1000 - 10 * 2) / 3 = 326.67，三列铺满容器宽度。
    expect(layout.columnWidth).toBeCloseTo((1000 - 20) / 3, 5);
    const used =
      layout.columnWidth * layout.columns + 10 * (layout.columns - 1);
    expect(used).toBeCloseTo(1000, 5);
  });

  it("每张照片落进当前最矮的那一列", () => {
    const layout = layoutMasonry(
      [
        { id: "tall", ratio: 0.5 },
        { id: "short", ratio: 2 },
        { id: "next", ratio: 1 },
      ],
      { containerWidth: 620, targetColumnWidth: 300, gap: 10 },
    );
    expect(layout.columns).toBe(2);
    const [first, second, third] = layout.tiles;
    // 第一张进第一列，第二张进第二列（更高的那一列还空着）。
    expect(first.x).toBe(0);
    expect(second.x).toBeGreaterThan(0);
    // 第三张落进此时更矮的那一列。
    expect(third.y).toBeLessThan(
      Math.max(first.y + first.height, second.y + second.height),
    );
  });

  it("每张按自己的比例占位，竖幅不被压成方的", () => {
    const layout = layoutMasonry([{ id: "a", ratio: 0.5 }], {
      containerWidth: 600,
      targetColumnWidth: 300,
      gap: 10,
    });
    // 比例是宽 / 高：0.5 表示高是宽的两倍。
    expect(layout.tiles[0].height).toBeCloseTo(layout.tiles[0].width * 2, 5);
  });

  it("整体高度取最高的一列", () => {
    const layout = layoutMasonry(
      [
        { id: "a", ratio: 1 },
        { id: "b", ratio: 1 },
      ],
      { containerWidth: 620, targetColumnWidth: 300, gap: 10 },
    );
    expect(layout.height).toBeCloseTo(layout.columnWidth, 5);
  });

  it("容器没宽度或没有照片时什么都不排", () => {
    expect(
      layoutMasonry([{ id: "a", ratio: 1 }], {
        containerWidth: 0,
        targetColumnWidth: 300,
        gap: 10,
      }),
    ).toEqual({ tiles: [], height: 0, columns: 0, columnWidth: 0 });
    expect(
      layoutMasonry([], {
        containerWidth: 600,
        targetColumnWidth: 300,
        gap: 10,
      }).tiles,
    ).toEqual([]);
  });

  it("比例缺失时按默认比例占位，不塌成零高", () => {
    const layout = layoutMasonry([{ id: "a", ratio: 0 }], {
      containerWidth: 600,
      targetColumnWidth: 300,
      gap: 10,
    });
    expect(layout.tiles[0].height).toBeGreaterThan(0);
  });

  it("图片之外还有说明区时，卡片按说明区的高度一起占位", () => {
    const layout = layoutMasonry([{ id: "a", ratio: 2, extraHeight: 52 }], {
      containerWidth: 600,
      targetColumnWidth: 300,
      gap: 10,
    });
    // 卡片高 = 封面高（宽 / 比例）+ 说明区高。
    expect(layout.tiles[0].height).toBeCloseTo(
      layout.tiles[0].width / 2 + 52,
      5,
    );
  });

  it("比例定死时同一行的卡片顶边齐平、一样高", () => {
    const layout = layoutMasonry(
      Array.from({ length: 6 }, (_, index) => ({
        id: `a${index}`,
        ratio: 1,
        extraHeight: 74,
      })),
      { containerWidth: 600, targetColumnWidth: 190, gap: 10 },
    );
    // 三列，六张卡排成两行：每行顶边相同，卡片一样高。
    const byTop = new Map<number, typeof layout.tiles>();
    for (const tile of layout.tiles) {
      const row = byTop.get(tile.y) ?? [];
      row.push(tile);
      byTop.set(tile.y, row);
    }
    expect(byTop.size).toBe(2);
    for (const row of byTop.values()) {
      expect(row).toHaveLength(3);
      expect(new Set(row.map((tile) => tile.height)).size).toBe(1);
    }
  });

  it("明确给列数时按给的列数排，末行不是孤零零一张", () => {
    const layout = layoutMasonry(
      Array.from({ length: 6 }, (_, index) => ({ id: `a${index}`, ratio: 1 })),
      { containerWidth: 600, targetColumnWidth: 200, gap: 10, columns: 3 },
    );
    expect(layout.columns).toBe(3);
    const byTop = new Map<number, number>();
    for (const tile of layout.tiles) {
      byTop.set(tile.y, (byTop.get(tile.y) ?? 0) + 1);
    }
    expect([...byTop.values()]).toEqual([3, 3]);
  });
});
