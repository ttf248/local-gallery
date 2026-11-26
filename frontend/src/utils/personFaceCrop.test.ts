import { describe, expect, it } from "vitest";
import { personFaceCrop } from "./personFaceCrop";
import type { FaceBox } from "../api/aiJobs";

describe("personFaceCrop", () => {
  it("把脸放到方块中央", () => {
    // 1000×1000 的照片，脸在正中、边长 200：方块覆盖 250 像素，
    // 图片因此放大到 400%，脸正好占满方块的八成。
    expect(personFaceCrop([400, 400, 200, 200], 1000, 1000, 136)).toEqual({
      displayWidth: 544,
      style: {
        position: "absolute",
        left: "-150%",
        top: "-150%",
        width: "400%",
        height: "400%",
        maxWidth: "none",
      },
    });
  });

  it("脸的中心不在正中时按中心对齐", () => {
    const style = personFaceCrop([100, 100, 100, 100], 1000, 1000, 136);
    expect(style?.style.left).toBe("-70%");
    expect(style?.style.top).toBe("-70%");
  });

  it("方块不超过原图短边，图始终盖满方块", () => {
    // 脸几乎占满整张图：span 被原图短边卡住，图片正好等于方块。
    const style = personFaceCrop([0, 0, 900, 900], 1000, 1000, 136);
    expect(style?.style.left).toBe("0%");
    expect(style?.style.top).toBe("0%");
    expect(style?.style.width).toBe("100%");
    expect(style?.style.height).toBe("100%");
  });

  it("忽略不合法的框与尺寸", () => {
    expect(
      personFaceCrop([0, 0, 1] as unknown as FaceBox, 1000, 1000, 136),
    ).toBeNull();
    expect(personFaceCrop([0, 0, 10, 10], 0, 1000, 136)).toBeNull();
    expect(personFaceCrop([0, 0, 0, 10], 1000, 1000, 136)).toBeNull();
  });
});
