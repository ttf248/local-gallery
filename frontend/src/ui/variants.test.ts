import { it, expect } from "vitest";
import { variants } from "./variants";
it("按配置顺序应用默认值、覆盖与外部类名", () => {
  const style = variants({
    base: "control",
    variants: {
      size: { sm: "small", md: "medium" },
      tone: { base: "base", alert: "alert" },
    },
    defaults: { size: "md", tone: "base" },
  });
  expect(style()).toBe("control medium base");
  expect(style({ tone: "alert", size: undefined, className: "wide" })).toBe(
    "control medium alert wide",
  );
  expect(style({ size: "sm", tone: "alert" })).toBe(
    style({ tone: "alert", size: "sm" }),
  );
});
