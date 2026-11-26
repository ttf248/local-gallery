import { COLOR_ROLES } from "./tokens";
import { expect, it } from "vitest";
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
it("两套主题都定义全套颜色角色", () => {
  for (const theme of [light, dark]) {
    for (const role of COLOR_ROLES) expect(token(theme, role)).toBeTruthy();
  }
});
it.each([comic, comicDark])("漫画仅覆盖主按钮与封面四项", (source) => {
  expect([...source.matchAll(/--([\w-]+):/g)].map((m) => m[1]).sort()).toEqual([
    "brand-soft",
    "cover-band",
    "on-primary",
    "primary",
  ]);
});
function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function color(theme: string, name: string) {
  const value = token(theme, name);
  const ref = /^var\(--([\w-]+)\)$/.exec(value);
  return luminance(ref ? token(css, ref[1]) : value);
}
function contrast(theme: string, fg: string, bg: string) {
  const a = color(theme, fg),
    b = color(theme, bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
it.each([light, dark])("前景文字、选中与焦点达到对比度下限", (theme) => {
  for (const [fg, bg] of [
    ["ink", "canvas"],
    ["ink-2", "sunken"],
    ["ink-3", "app"],
    ["ink-3", "raised"],
    ["on-primary", "primary"],
    ["on-accent", "accent"],
    ["accent-text", "canvas"],
    ["danger", "canvas"],
    ["success", "canvas"],
    ["warning", "canvas"],
    ["favorite", "canvas"],
    ["on-inverse", "inverse"],
  ])
    expect(contrast(theme, fg, bg), fg + "/" + bg).toBeGreaterThanOrEqual(4.5);
  expect(contrast(theme, "accent", "canvas")).toBeGreaterThanOrEqual(3);
});
it.each([comic, comicDark])("漫画主按钮达到 AA", (theme) => {
  expect(contrast(theme, "on-primary", "primary")).toBeGreaterThanOrEqual(4.5);
});
