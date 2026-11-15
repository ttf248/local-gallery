import { describe, expect, it } from "vitest";
import { personFaceFrameStyle } from "./personFaceFrame";
import type { FaceBox } from "../api/aiJobs";

describe("personFaceFrameStyle", () => {
  it("accounts for the vertical crop of an object-fit cover tile", () => {
    expect(
      personFaceFrameStyle([400, 100, 100, 150], 800, 600, 400, 200),
    ).toEqual({
      left: "50%",
      top: "0%",
      width: "12.5%",
      height: "37.5%",
    });
  });

  it("clips source face boxes to the image bounds", () => {
    expect(
      personFaceFrameStyle([-20, 10, 100, 100], 400, 400, 200, 200),
    ).toEqual({
      left: "0%",
      top: "2.5%",
      width: "20%",
      height: "25%",
    });
  });

  it("ignores invalid boxes and tile dimensions", () => {
    // 服务端给回来的框未必是四个数：类型说它应该是，运行时还得再挡一道。
    expect(
      personFaceFrameStyle([0, 0, 1] as unknown as FaceBox, 400, 400, 200, 200),
    ).toBeNull();
    expect(personFaceFrameStyle([0, 0, 10, 10], 0, 400, 200, 200)).toBeNull();
    expect(
      personFaceFrameStyle([500, 500, 10, 10], 400, 400, 200, 200),
    ).toBeNull();
  });
});
