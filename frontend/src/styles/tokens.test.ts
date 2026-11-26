import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const TOKENS = path.resolve(__dirname, "tokens.css");
const css = readFileSync(TOKENS, "utf-8").replace(/\r\n/g, "\n");

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

const comicDark = block(':root[data-mode="comic"][data-theme="dark"]');
const roles =
  "bg bg-elevated bg-subtle bg-strong bg-media fg fg-muted fg-subtle line line-strong accent accent-contrast accent-soft signal signal-soft favorite success warning danger inverse-bg inverse-fg".split(
    " ",
  );
it("纸白与暗房均定义全套颜色角色", () => {
  for (const theme of [light, dark])
    for (const role of roles) expect(token(theme, role)).toBeTruthy();
  expect(css).not.toMatch(/--rail-/);
  expect(token(light, "signal")).toBe("#2f6bff");
  expect(token(dark, "signal")).toBe("#7fa4ff");
});
it.each([
  [comic, "#8a4f2d"],
  [comicDark, "#d9a074"],
])("漫画仅替换强调与书脊", (source, accent) => {
  expect([...source.matchAll(/--([\w-]+):/g)].map((m) => m[1]).sort()).toEqual(
    ["accent", "accent-contrast", "accent-soft", "cover-band"],
  );
  expect(token(source, "accent")).toBe(accent);
  expect(token(source, "cover-band")).toContain("74 48 29");
});
function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

describe.each([
  ["纸白", light, "#f7f7f5"],
  ["暗房", dark, "#0a0a0b"],
])("%s", (_theme, source, background) => {
  it("画布颜色符合方案，正文、辅助文字和主要操作达到 AA", () => {
    expect(token(source, "bg")).toBe(background);
    for (const [foreground, base] of [
      ["fg", "bg"],
      ["fg-muted", "bg-subtle"],
      ["fg-subtle", "bg"],
      ["accent-contrast", "accent"],
      ["signal-text", "bg"],
      ["danger-text", "bg"],
      ["success-text", "bg"],
      ["warning-text", "bg"],
      ["favorite-text", "bg"],
    ]) {
      const pair = [
        luminance(
          token(source, foreground).startsWith("var(")
            ? token(source, foreground.replace("-text", ""))
            : token(source, foreground),
        ),
        luminance(token(source, base)),
      ];
      const ratio = (Math.max(...pair) + 0.05) / (Math.min(...pair) + 0.05);
      expect(ratio, `${foreground} / ${base}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

it.each([comic, comicDark])("漫画主按钮文字达到 AA", (source) => {
  const pair = [
    luminance(token(source, "accent")),
    luminance(token(source, "accent-contrast")),
  ];
  expect(
    (Math.max(...pair) + 0.05) / (Math.min(...pair) + 0.05),
  ).toBeGreaterThanOrEqual(4.5);
});
