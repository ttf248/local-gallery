import { describe, expect, it } from "vitest";
import {
  SMART_ALBUM_CAPTION_HEIGHT,
  SMART_ALBUM_RECOMMENDATION_CAPTION_HEIGHT,
  smartAlbumCaptionHeight,
  smartAlbumEvidenceDimensions,
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
