import {
  DEFAULT_TILE_RATIO,
  layoutGroup,
  type PlacedTile,
  type WallTile,
} from "../wall";
export interface SectionInput {
  key: string;
  year: string;
  tiles: WallTile[];
}
export interface PackOptions {
  containerWidth: number;
  targetHeight: number;
  gap: number;
  sectionGap?: number;
  headerHeight?: number;
  maxInlineTiles?: number;
  maxInlineRatio?: number;
  minContainerWidth?: number;
}
export interface PackedSegment {
  key: string;
  x: number;
  width: number;
  tiles: PlacedTile[];
}
export type WallBand =
  | {
      kind: "inline";
      key: string;
      height: number;
      tileHeight: number;
      segments: PackedSegment[];
    }
  | { kind: "header"; key: string; height: number; sectionKey: string }
  | {
      kind: "row";
      key: string;
      height: number;
      tileHeight: number;
      sectionKey: string;
      tiles: PlacedTile[];
    };
export function packSections(
  sections: readonly SectionInput[],
  {
    containerWidth,
    targetHeight,
    gap,
    sectionGap = 32,
    headerHeight = 56,
    maxInlineTiles = 6,
    maxInlineRatio = 0.6,
    minContainerWidth = 640,
  }: PackOptions,
): WallBand[] {
  if (containerWidth <= 0 || targetHeight <= 0) return [];
  const bands: WallBand[] = [];
  let pending: PackedSegment[] = [],
    width = 0,
    year = "";
  function standalone(key: string, tiles: WallTile[]) {
    bands.push({
      kind: "header",
      key: "header:" + key,
      height: headerHeight,
      sectionKey: key,
    });
    for (const row of layoutGroup(tiles, {
      containerWidth,
      targetHeight,
      gap,
      sparseMinHeight: targetHeight,
      sparseMaxHeight: targetHeight,
    })) {
      bands.push({
        ...row,
        kind: "row",
        key: "row:" + row.tiles[0].id,
        sectionKey: key,
      });
    }
  }
  function flush() {
    if (pending.length === 1) standalone(pending[0].key, pending[0].tiles);
    if (pending.length > 1)
      bands.push({
        kind: "inline",
        key: "inline:" + pending[0].key,
        height: headerHeight + targetHeight + gap,
        tileHeight: targetHeight,
        segments: pending,
      });
    pending = [];
    width = 0;
  }
  for (const section of sections) {
    if (!section.tiles.length) continue;
    const tiles = section.tiles.map((tile) => ({
      ...tile,
      ratio:
        Number.isFinite(tile.ratio) && tile.ratio > 0
          ? Math.min(3, Math.max(0.4, tile.ratio))
          : DEFAULT_TILE_RATIO,
    }));
    const natural =
      tiles.reduce((sum, tile) => sum + tile.ratio * targetHeight, 0) +
      gap * (tiles.length - 1);
    const eligible =
      containerWidth >= minContainerWidth &&
      section.key !== "unknown" &&
      tiles.length <= maxInlineTiles &&
      natural <= containerWidth * maxInlineRatio;
    if (!eligible) {
      flush();
      standalone(section.key, tiles);
      continue;
    }
    if (
      pending.length &&
      (section.year !== year || width + sectionGap + natural > containerWidth)
    )
      flush();
    const x = pending.length ? width + sectionGap : 0;
    pending.push({
      key: section.key,
      x,
      width: natural,
      tiles: tiles.map((tile) => ({
        ...tile,
        width: tile.ratio * targetHeight,
      })),
    });
    width = x + natural;
    year = section.year;
  }
  flush();
  return bands;
}
