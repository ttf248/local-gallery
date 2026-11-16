import { describe, expect, it } from "vitest";
import {
  SMART_ALBUM_CAPTION_HEIGHT,
  SMART_ALBUM_COVER_RATIO,
  SMART_ALBUM_RECOMMENDATION_CAPTION_HEIGHT,
  smartAlbumCaptionHeight,
  smartAlbumEvidenceDimensions,
  smartAlbumPreviewColumns,
} from "./smartAlbum";

describe("智能相册说明区高度", () => {
  it("推荐的说明区比详细分类高一行（多一行证据芯片）", () => {
    expect(SMART_ALBUM_RECOMMENDATION_CAPTION_HEIGHT).toBeGreaterThan(
      SMART_ALBUM_CAPTION_HEIGHT,
    );
  });

  it("按维度给出对应的高度", () => {
    expect(
      smartAlbumCaptionHeight({
        albumId: "a_1",
        albumName: "相册",
        group: { dimension: "recommended" } as never,
      }),
    ).toBe(SMART_ALBUM_RECOMMENDATION_CAPTION_HEIGHT);
    expect(
      smartAlbumCaptionHeight({
        albumId: "a_1",
        albumName: "相册",
        group: { dimension: "scene" } as never,
      }),
    ).toBe(SMART_ALBUM_CAPTION_HEIGHT);
  });
});

describe("证据维度", () => {
  it("按时间、地点、人物、场景的固定顺序返回并去重", () => {
    expect(
      smartAlbumEvidenceDimensions({
        evidenceDimensions: ["scene", "time", "scene", "people"],
      }),
    ).toEqual(["time", "people", "scene"]);
  });

  it("没有证据维度时返回空数组", () => {
    expect(smartAlbumEvidenceDimensions({})).toEqual([]);
    expect(smartAlbumEvidenceDimensions({ evidenceDimensions: [] })).toEqual(
      [],
    );
  });
});

describe("封面比例", () => {
  it("主题封面统一裁成正方形", () => {
    expect(SMART_ALBUM_COVER_RATIO).toBe(1);
  });
});

describe("首页预览的列数", () => {
  it("在能整除卡片数的因数里挑不超过算出值的最大那个", () => {
    // 六张卡：算出一列就一列，五列时落到三列（两行三张），七列时六列。
    expect(smartAlbumPreviewColumns(1, 6)).toBe(1);
    expect(smartAlbumPreviewColumns(5, 6)).toBe(3);
    expect(smartAlbumPreviewColumns(7, 6)).toBe(6);
    expect(smartAlbumPreviewColumns(2, 6)).toBe(2);
    expect(smartAlbumPreviewColumns(4, 6)).toBe(3);
  });

  it("挑不出因数时按算出的列数来，宁可末行不满也不把卡挤成一列", () => {
    // 五是素数：四列时挑不出能整除的因数，又不能退回一列。
    expect(smartAlbumPreviewColumns(4, 5)).toBe(4);
    expect(smartAlbumPreviewColumns(1, 5)).toBe(1);
  });

  it("没有卡片时不动列数", () => {
    expect(smartAlbumPreviewColumns(5, 0)).toBe(5);
  });
});
