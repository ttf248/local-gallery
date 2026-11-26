import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const TOKENS = path.resolve(__dirname, "tokens.css");
const css = readFileSync(TOKENS, "utf-8");

/** 取某个选择器块里的内容（按第一个 '{' 与配对的 '}' 截取）。 */
function block(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `样式表里找不到 ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  expect(close).toBeGreaterThan(open);
  return css.slice(open + 1, close);
}

/** 取块里某个 token 的值（去空白）。 */
function token(source: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(source);
  expect(match, `样式表里找不到 --${name}`).not.toBeNull();
  return (match?.[1] ?? "").trim();
}

const light = block(':root,\n:root[data-theme="light"]');
const dark = block(':root[data-theme="dark"]');
const comic = block(':root[data-mode="comic"]');

describe("漫画工作台的暖棕强调色", () => {
  it("两套主题都给出漫画强调色这一族", () => {
    for (const source of [light, dark]) {
      for (const name of [
        "comic-accent",
        "comic-accent-hover",
        "comic-accent-soft",
        "comic-accent-ink",
        "comic-accent-contrast",
      ]) {
        expect(token(source, name), `${name} 缺失`).not.toBe("");
      }
    }
  });

  it("浅色用 #8A4F2D，深色用 #D9A074", () => {
    expect(token(light, "comic-accent").toLowerCase()).toBe("#8a4f2d");
    expect(token(dark, "comic-accent").toLowerCase()).toBe("#d9a074");
  });

  it("漫画侧把强调色一族指向暖棕，焦点环与侧栏选中项一起换", () => {
    expect(token(comic, "accent")).toBe("var(--comic-accent)");
    expect(token(comic, "accent-hover")).toBe("var(--comic-accent-hover)");
    expect(token(comic, "accent-soft")).toBe("var(--comic-accent-soft)");
    expect(token(comic, "accent-ink")).toBe("var(--comic-accent-ink)");
    expect(token(comic, "accent-contrast")).toBe(
      "var(--comic-accent-contrast)",
    );
    expect(token(comic, "focus")).toBe("var(--comic-accent)");
    expect(token(comic, "rail-active")).toBe("var(--comic-rail-active)");
    expect(token(comic, "rail-active-fg")).toBe("var(--comic-rail-active-fg)");
  });

  it("照片工作台使用炭黑与象牙白", () => {
    expect(token(light, "accent").toLowerCase()).not.toContain("comic");
    expect(token(light, "accent").toLowerCase()).toBe("#1c1917");
    expect(token(dark, "accent").toLowerCase()).toBe("#f4f3ef");
  });

  it("书名压条用暖棕：漫画侧的封面标签不是近黑", () => {
    expect(token(comic, "cover-band")).toContain("74 48 29");
    // 基础档（照片侧）仍用近黑：那条压条在照片侧不出现，但留着无害且统一。
    expect(token(light, "cover-band")).toContain("0 0 0");
  });
});
function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

describe.each([
  ["暖白画廊", light, "#faf9f6"],
  ["曜石暗房", dark, "#0c0c0e"],
])("%s", (_theme, source, background) => {
  it("画布颜色符合方案，正文、辅助文字和主要操作达到 AA", () => {
    expect(token(source, "bg")).toBe(background);
    for (const [foreground, base] of [
      ["fg", "bg"],
      ["fg-muted", "bg-subtle"],
      ["fg-subtle", "bg"],
      ["accent-contrast", "accent"],
      ["accent-ink", "accent-soft"],
      ["comic-accent-contrast", "comic-accent"],
      ["comic-accent-ink", "comic-accent-soft"],
      ["danger", "bg"],
      ["success", "bg"],
      ["warning", "bg"],
      ["favorite", "bg"],
    ]) {
      const pair = [
        luminance(token(source, foreground)),
        luminance(token(source, base)),
      ];
      const ratio = (Math.max(...pair) + 0.05) / (Math.min(...pair) + 0.05);
      expect(ratio, `${foreground} / ${base}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
