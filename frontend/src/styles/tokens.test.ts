import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 主题 token 的契约测试。
 *
 * 两件事靠这份文件守住：
 *   1. 漫画工作台有一支自己的暖棕强调色（浅色 #8E6848 / 深色 #D4AA80），
 *      两套主题都要给出这一族。
 *   2. 漫画侧把「强调色」这一族指向暖棕，照片侧仍是品牌蓝 —— 换的是
 *      色相，不是系统：角色名、结构与组件都不变。
 *
 * 这类事实写在 CSS 里，组件测试看不见；样式表被改坏时（暖棕只写进一套
 * 主题、语义重映射被删掉），界面会静默地退回另一种颜色语言。
 */

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
        "comic-rail-active",
        "comic-rail-active-fg",
      ]) {
        expect(token(source, name), `${name} 缺失`).not.toBe("");
      }
    }
  });

  it("浅色用 #8E6848，深色用 #D4AA80", () => {
    expect(token(light, "comic-accent").toLowerCase()).toBe("#8e6848");
    expect(token(dark, "comic-accent").toLowerCase()).toBe("#d4aa80");
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

  it("照片侧仍是品牌蓝：基础档的强调色不是暖棕", () => {
    expect(token(light, "accent").toLowerCase()).not.toContain("comic");
    expect(token(light, "accent").toLowerCase()).toBe("#476c8d");
    expect(token(dark, "accent").toLowerCase()).toBe("#91bdd9");
  });

  it("书名压条用暖棕：漫画侧的封面标签不是近黑", () => {
    expect(token(comic, "cover-band")).toContain("74 48 29");
    // 基础档（照片侧）仍用近黑：那条压条在照片侧不出现，但留着无害且统一。
    expect(token(light, "cover-band")).toContain("0 0 0");
  });
});
