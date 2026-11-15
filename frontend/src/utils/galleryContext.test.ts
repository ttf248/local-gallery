import { beforeEach, describe, expect, it } from "vitest";
import {
  entryDisplayName,
  entryReaderUrl,
  getGalleryContext,
  type GalleryContextEntry,
} from "./galleryContext";

function entry(overrides: Partial<GalleryContextEntry> = {}): GalleryContextEntry {
  return {
    key: "a_1",
    to: "/albums/a_1",
    name: "某本相册",
    ...overrides,
  };
}

describe("entryReaderUrl", () => {
  it("漫画相册有阅读器入口", () => {
    const url = entryReaderUrl(entry({ contentKind: "comic" }));
    expect(url).toBe("/comic/read/a_1?index=0&name=%E6%9F%90%E6%9C%AC%E7%9B%B8%E5%86%8C");
  });

  it("照片相册没有阅读器入口：照片要进照片墙", () => {
    expect(entryReaderUrl(entry({ contentKind: "photo" }))).toBeNull();
  });

  it("集合没有阅读器入口", () => {
    expect(
      entryReaderUrl(entry({ kind: "collection", contentKind: "comic" })),
    ).toBeNull();
  });
});

// 漫画的卷名只写「第1卷」：跳本提示与跨卷箭头要说得清这一卷属于哪部。
describe("entryDisplayName", () => {
  it("有所属作品时把作品名补在卷名前面", () => {
    expect(
      entryDisplayName(entry({ name: "第1卷", parentName: "星海漫步" })),
    ).toBe("星海漫步 · 第1卷");
  });

  it("没有所属作品时只写卷名", () => {
    expect(entryDisplayName(entry({ name: "第1卷" }))).toBe("第1卷");
  });

  it("作品名与卷名相同时不重复", () => {
    expect(
      entryDisplayName(entry({ name: "星海漫步", parentName: "星海漫步" })),
    ).toBe("星海漫步");
  });
});

// sessionStorage 里可能是上一版的结构，也可能被别的脚本写过。
// 形状不对就当没有上下文：缺字段的上下文会让阅读器在「上一本 / 下一本」
// 上取到 undefined，整页直接崩。
describe("getGalleryContext", () => {
  const KEY = "local-gallery-context";

  beforeEach(() => {
    sessionStorage.clear();
  });

  it("读不到上下文时返回 null", () => {
    expect(getGalleryContext()).toBeNull();
  });

  it("形状不对的存量数据按没有上下文处理", () => {
    sessionStorage.setItem(KEY, JSON.stringify({ list: "不是数组" }));
    expect(getGalleryContext()).toBeNull();

    sessionStorage.setItem(KEY, JSON.stringify({ list: [], index: "第一" }));
    expect(getGalleryContext()).toBeNull();

    sessionStorage.setItem(KEY, JSON.stringify({ list: [{}], index: 0 }));
    expect(getGalleryContext()).toBeNull();

    sessionStorage.setItem(KEY, JSON.stringify({ list: [], index: 0 }));
    expect(getGalleryContext()).toBeNull();
  });

  it("坏掉的 JSON 按没有上下文处理", () => {
    sessionStorage.setItem(KEY, "{不是 JSON");
    expect(getGalleryContext()).toBeNull();
  });

  it("形状正确时读回上下文", () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        source: { type: "home" },
        list: [{ key: "a_1", to: "/photo/albums/a_1", name: "旅行" }],
        index: 0,
        openedAt: 1,
      }),
    );
    expect(getGalleryContext()?.list[0]?.name).toBe("旅行");
  });
});
