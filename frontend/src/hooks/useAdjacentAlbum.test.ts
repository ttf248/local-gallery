import { describe, expect, it } from "vitest";
import { resolveAdjacentEntry } from "./useAdjacentAlbum";
import type { GalleryContextEntry } from "../utils/galleryContext";

function entry(
  key: string,
  extra: Partial<GalleryContextEntry> = {},
): GalleryContextEntry {
  return {
    key,
    to: `/comic/albums/${key}`,
    name: `第${key}卷`,
    kind: "album",
    imageCount: 8,
    videoCount: 0,
    contentKind: "comic",
    ...extra,
  };
}

function ctx(list: GalleryContextEntry[], index = 0) {
  return {
    source: { type: "collection" as const, parentPath: "" },
    list,
    index,
    openedAt: Date.now(),
  };
}

const options = { albumsOnly: false, isVideo: false };

describe("跨卷导航的相邻查找", () => {
  it("往后找得到下一卷", () => {
    const found = resolveAdjacentEntry(
      ctx([entry("a"), entry("b"), entry("c")], 0),
      "a",
      1,
      options,
    );
    expect(found?.entry.key).toBe("b");
  });

  it("往前找得到上一卷", () => {
    const found = resolveAdjacentEntry(
      ctx([entry("a"), entry("b"), entry("c")], 2),
      "c",
      -1,
      options,
    );
    expect(found?.entry.key).toBe("b");
  });

  // 环绕会让「读完自动切下一卷」在最后一卷把读者甩回开头，
  // 读起来像跳错了一本。
  it("最后一卷没有下一卷，不绕回开头", () => {
    const found = resolveAdjacentEntry(
      ctx([entry("a"), entry("b"), entry("c")], 2),
      "c",
      1,
      options,
    );
    expect(found).toBeNull();
  });

  it("第一卷没有上一卷，不绕到末尾", () => {
    const found = resolveAdjacentEntry(
      ctx([entry("a"), entry("b"), entry("c")], 0),
      "a",
      -1,
      options,
    );
    expect(found).toBeNull();
  });

  // 拿列表第一项当锚点乱跳，比没有导航更糟。
  it("当前这一卷不在列表里时不猜", () => {
    const found = resolveAdjacentEntry(
      ctx([entry("a"), entry("b")], 0),
      "z",
      1,
      options,
    );
    expect(found).toBeNull();
  });

  it("跳过没有阅读器入口的作品", () => {
    const found = resolveAdjacentEntry(
      ctx([
        entry("a"),
        entry("work", { kind: "collection", to: "/comic/albums/work" }),
        entry("b"),
      ]),
      "a",
      1,
      options,
    );
    expect(found?.entry.key).toBe("b");
  });

  it("只找卷时跳过没有可读媒体的卷", () => {
    const found = resolveAdjacentEntry(
      ctx([entry("a"), entry("empty", { imageCount: 0 }), entry("b")]),
      "a",
      1,
      { albumsOnly: true, isVideo: false },
    );
    expect(found?.entry.key).toBe("b");
  });
});
