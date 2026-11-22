import { describe, expect, it } from "vitest";
import {
  autoTargetHeight,
  DEFAULT_TILE_RATIO,
  layoutGroup,
  layoutJustified,
  layoutSparse,
  SPARSE_MAX_HEIGHT,
  SPARSE_MIN_HEIGHT,
  tileRatio,
  type WallTile,
} from "./justifiedLayout";

function tiles(count: number, ratio = 1.5): WallTile[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `t${index}`,
    ratio,
  }));
}

const options = { containerWidth: 1200, targetHeight: 200, gap: 8 };

describe("layoutJustified", () => {
  it("把每一行铺满容器宽度", () => {
    const rows = layoutJustified(tiles(12), options);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(0, -1)) {
      const total =
        row.tiles.reduce((sum, tile) => sum + tile.width, 0) +
        options.gap * (row.tiles.length - 1);
      expect(total).toBeCloseTo(options.containerWidth, 5);
    }
  });

  it("保留所有条目且顺序不变", () => {
    const rows = layoutJustified(tiles(17), options);
    const ids = rows.flatMap((row) => row.tiles.map((tile) => tile.id));
    expect(ids).toEqual(tiles(17).map((tile) => tile.id));
  });

  it("按真实比例给不同画幅不同宽度", () => {
    const rows = layoutJustified(
      [
        { id: "wide", ratio: 2 },
        { id: "square", ratio: 1 },
        { id: "tall", ratio: 0.5 },
      ],
      { containerWidth: 1200, targetHeight: 200, gap: 8 },
    );
    const row = rows[0];
    const wide = row.tiles.find((tile) => tile.id === "wide")!;
    const square = row.tiles.find((tile) => tile.id === "square")!;
    const tall = row.tiles.find((tile) => tile.id === "tall")!;
    expect(wide.width).toBeGreaterThan(square.width);
    expect(square.width).toBeGreaterThan(tall.width);
  });

  it("末行不为了填满宽度而放大", () => {
    const rows = layoutJustified(tiles(3), options);
    expect(rows).toHaveLength(1);
    expect(rows[0].tileHeight).toBeLessThanOrEqual(options.targetHeight);
  });

  it("末行与上面的行一样高，不矮一截", () => {
    const rows = layoutJustified(tiles(7), options);
    const last = rows[rows.length - 1];
    const previous = rows[rows.length - 2];
    expect(last.tileHeight).toBeCloseTo(previous.tileHeight, 5);
  });

  it("单张竖图不会顶满屏幕", () => {
    const rows = layoutJustified([{ id: "tall", ratio: 0.4 }], {
      containerWidth: 1200,
      targetHeight: 200,
      gap: 8,
    });
    expect(rows[0].tileHeight).toBeLessThanOrEqual(200 * 1.8 + 0.001);
  });

  it("容器宽度或目标行高无效时返回空结果", () => {
    expect(layoutJustified(tiles(3), { ...options, containerWidth: 0 })).toEqual(
      [],
    );
    expect(layoutJustified([], options)).toEqual([]);
  });

  it("非法比例退回默认比例", () => {
    const rows = layoutJustified([{ id: "bad", ratio: 0 }], options);
    expect(rows[0].tiles[0].ratio).toBe(DEFAULT_TILE_RATIO);
  });
});

describe("layoutSparse", () => {
  const sparse = { containerWidth: 1200, gap: 8 };

  it("稀疏段落不铺满容器宽度", () => {
    const rows = layoutSparse(tiles(1), sparse);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    const total =
      row.tiles.reduce((sum, tile) => sum + tile.width, 0) +
      sparse.gap * (row.tiles.length - 1);
    // 一张照片铺满一千二百像素宽，看起来像加载失败，不像一张照片。
    expect(total).toBeLessThan(sparse.containerWidth);
  });

  it("图片高度落在 220–280 之间", () => {
    for (const count of [1, 2, 3]) {
      const row = layoutSparse(tiles(count), sparse)[0];
      expect(row.tileHeight).toBeGreaterThanOrEqual(SPARSE_MIN_HEIGHT);
      expect(row.tileHeight).toBeLessThanOrEqual(SPARSE_MAX_HEIGHT);
    }
  });

  it("保留每张照片自己的比例", () => {
    const rows = layoutSparse(
      [
        { id: "wide", ratio: 2 },
        { id: "tall", ratio: 0.5 },
      ],
      sparse,
    );
    const row = rows[0];
    const wide = row.tiles.find((tile) => tile.id === "wide")!;
    const tall = row.tiles.find((tile) => tile.id === "tall")!;
    expect(wide.width / row.tileHeight).toBeCloseTo(2, 5);
    expect(tall.width / row.tileHeight).toBeCloseTo(0.5, 5);
  });

  it("超过上限张数就不走稀疏排布", () => {
    expect(layoutSparse(tiles(4), sparse)).toEqual([]);
  });

  it("挤成细条时退回铺满排布", () => {
    // 三张极端宽幅：压到能看的高度都不到，就交给 justified。
    const rows = layoutSparse(
      [
        { id: "a", ratio: 4 },
        { id: "b", ratio: 4 },
        { id: "c", ratio: 4 },
      ],
      sparse,
    );
    expect(rows).toEqual([]);
  });
});

describe("layoutGroup", () => {
  it("稀疏段落走稀疏排布，密集段落走铺满排布", () => {
    const sparseRows = layoutGroup(tiles(2), {
      containerWidth: 1200,
      gap: 8,
      targetHeight: 240,
    });
    expect(sparseRows).toHaveLength(1);
    expect(sparseRows[0].tileHeight).toBeGreaterThanOrEqual(SPARSE_MIN_HEIGHT);

    const denseRows = layoutGroup(tiles(12), {
      containerWidth: 1200,
      gap: 8,
      targetHeight: 240,
    });
    expect(denseRows.length).toBeGreaterThan(1);
    // 密集段每一行都铺满容器宽度。
    const first = denseRows[0];
    const total =
      first.tiles.reduce((sum, tile) => sum + tile.width, 0) +
      8 * (first.tiles.length - 1);
    expect(total).toBeCloseTo(1200, 5);
  });
});

describe("tileRatio", () => {  it("优先使用服务端给出的像素尺寸", () => {
    expect(tileRatio({ kind: "image", width: 1600, height: 900 })).toBeCloseTo(
      16 / 9,
      5,
    );
  });

  it("视频使用 16:9", () => {
    expect(tileRatio({ kind: "video" })).toBeCloseTo(16 / 9, 5);
  });

  it("尺寸未知时退回默认比例", () => {
    expect(tileRatio({ kind: "image" })).toBe(DEFAULT_TILE_RATIO);
    expect(tileRatio(undefined)).toBe(DEFAULT_TILE_RATIO);
  });
});


describe("autoTargetHeight", () => {
  const auto = {
    containerWidth: 1200,
    containerHeight: 800,
    gap: 8,
    minTargetHeight: 210,
  };

  it("照片少时把行高抬上去，让每张占更多画面", () => {
    const height = autoTargetHeight(tiles(5), auto);
    expect(height).toBeGreaterThan(auto.minTargetHeight);
  });

  it("照片多时保持密度下限，不因为自适应反而更挤", () => {
    const height = autoTargetHeight(tiles(400), auto);
    expect(height).toBe(auto.minTargetHeight);
  });

  it("挑中的档位排出来的墙不超过两屏", () => {
    const height = autoTargetHeight(tiles(12), auto);
    const rows = layoutJustified(tiles(12), {
      containerWidth: auto.containerWidth,
      targetHeight: height,
      gap: auto.gap,
    });
    const wall = rows.reduce((sum, row) => sum + row.height, 0);
    expect(wall).toBeLessThanOrEqual(auto.containerHeight * 2);
  });

  it("照片少时每张比密度下限更大", () => {
    const height = autoTargetHeight(tiles(5), auto);
    const rows = layoutJustified(tiles(5), {
      containerWidth: auto.containerWidth,
      targetHeight: height,
      gap: auto.gap,
    });
    const dense = layoutJustified(tiles(5), {
      containerWidth: auto.containerWidth,
      targetHeight: auto.minTargetHeight,
      gap: auto.gap,
    });
    const area = (list: typeof rows) =>
      list.reduce(
        (sum, row) =>
          sum +
          row.tiles.reduce(
            (inner, tile) => inner + tile.width * row.tileHeight,
            0,
          ),
        0,
      );
    expect(area(rows)).toBeGreaterThan(area(dense));
  });

  it("容器尺寸无效时退回密度下限", () => {
    expect(autoTargetHeight(tiles(5), { ...auto, containerWidth: 0 })).toBe(
      auto.minTargetHeight,
    );
    expect(autoTargetHeight(tiles(5), { ...auto, containerHeight: 0 })).toBe(
      auto.minTargetHeight,
    );
    expect(autoTargetHeight([], auto)).toBe(auto.minTargetHeight);
  });

  it("窄屏上不会退化成一行一张", () => {
    const height = autoTargetHeight(tiles(5), {
      ...auto,
      containerWidth: 360,
      containerHeight: 700,
      minTargetHeight: 96,
      maxTargetHeight: 112,
    });
    const rows = layoutJustified(tiles(5), {
      containerWidth: 360,
      targetHeight: height,
      gap: auto.gap,
    });
    expect(rows[0].tiles.length).toBeGreaterThanOrEqual(2);
  });
});
