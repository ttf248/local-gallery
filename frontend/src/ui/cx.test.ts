import { it, expect } from "vitest";
import { cx } from "./cx";
it("过滤假值并保留顺序与重复项", () =>
  expect(cx("b", false, null, "a", 0, undefined, "", "a")).toBe("b a a"));
