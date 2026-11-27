import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useAdjacentAlbum } from "./useAdjacentAlbum";
import type { GalleryContextEntry } from "../utils/galleryContext";

function entry(key: string): GalleryContextEntry {
  return {
    key,
    to: `/comic/albums/${key}`,
    name: `第${key}卷`,
    kind: "album",
    imageCount: 8,
    videoCount: 0,
    contentKind: "comic",
  };
}

function writeContext(list: GalleryContextEntry[]) {
  sessionStorage.setItem(
    "local-gallery-context",
    JSON.stringify({
      source: { type: "collection", parentPath: "" },
      list,
      index: 0,
      openedAt: Date.now(),
    }),
  );
}

function renderAdjacent(
  pathParam: string,
  fallbackEntries?: GalleryContextEntry[],
) {
  return renderHook(
    () => useAdjacentAlbum({ pathParam, isVideo: false, fallbackEntries }),
    { wrapper: MemoryRouter },
  );
}

describe("跨卷导航的上下文兜底", () => {
  it("当前这一卷在上下文里就用上下文", () => {
    writeContext([entry("a"), entry("b"), entry("c")]);
    const { result } = renderAdjacent("b");
    expect(result.current.adjacentNames.next).toBe("第c卷");
    expect(result.current.adjacentNames.prev).toBe("第a卷");
  });

  // 从首页「继续阅读」进来说卷时，上一次写进上下文的可能是另一页
  // 列表 —— 那一页里没有这一卷，跨卷导航就没有落脚点。
  it("当前这一卷不在上下文里时用兄弟卷兜底", () => {
    writeContext([entry("x"), entry("y")]);
    const { result } = renderAdjacent("b", [
      entry("a"),
      entry("b"),
      entry("c"),
    ]);
    expect(result.current.adjacentNames.next).toBe("第c卷");
    expect(result.current.adjacentNames.prev).toBe("第a卷");
  });

  it("上下文里没有、也没有兄弟卷时不猜", () => {
    writeContext([entry("x"), entry("y")]);
    const { result } = renderAdjacent("b");
    expect(result.current.adjacentNames.next).toBe("");
    expect(result.current.adjacentNames.prev).toBe("");
  });

  it("兄弟卷里的最后一卷没有下一卷", () => {
    writeContext([entry("x")]);
    const { result } = renderAdjacent("c", [
      entry("a"),
      entry("b"),
      entry("c"),
    ]);
    expect(result.current.adjacentNames.next).toBe("");
    expect(result.current.adjacentNames.prev).toBe("第b卷");
    expect(result.current.adjacentNames.more).toBe(false);
  });
});
