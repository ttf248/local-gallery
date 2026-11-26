import { describe, expect, it } from "vitest";
import {
  clampMemberIndex,
  nextActiveAfterRemoval,
  resolveSimilarityView,
  shouldPrefetch,
} from "./reviewNavigation";
describe("审阅位置", () => {
  it("深链优先于屏宽，未知视图回落到宽屏审阅和窄屏网格", () => {
    for (const wide of [true, false]) {
      expect(resolveSimilarityView("review", wide)).toBe("review");
      expect(resolveSimilarityView("grid", wide)).toBe("grid");
      expect(resolveSimilarityView("other", wide)).toBe(
        wide ? "review" : "grid",
      );
    }
  });
  it("删除时选择下一组、上一组或空态", () => {
    expect(nextActiveAfterRemoval(["a", "b", "c"], "b")).toBe("c");
    expect(nextActiveAfterRemoval(["a", "b"], "b")).toBe("a");
    expect(nextActiveAfterRemoval(["a"], "a")).toBeNull();
    expect(nextActiveAfterRemoval(["a"], "unknown")).toBe("a");
  });
  it("成员下标不会越界，末尾五组触发预取", () => {
    expect(clampMemberIndex(-1, 3)).toBe(0);
    expect(clampMemberIndex(9, 3)).toBe(2);
    expect(clampMemberIndex(1, 0)).toBe(0);
    expect(shouldPrefetch(3, 10, true)).toBe(false);
    expect(shouldPrefetch(4, 10, true)).toBe(true);
    expect(shouldPrefetch(9, 10, false)).toBe(false);
    expect(shouldPrefetch(-1, 0, true)).toBe(false);
  });
});
