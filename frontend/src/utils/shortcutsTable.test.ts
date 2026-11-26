import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { SHORTCUTS } from "./shortcutsTable";

/**
 * 快捷键清单与实际处理必须一致。
 *
 * 帮助浮层直接消费这张表：表里写了「N 下一卷」，用户按下 N 却没有反应，
 * 比不写这一行更糟 —— 他会以为是自己按错了。清单是给用户看的契约，
 * 契约与实现对不上时，测试要拦下来。
 */

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    // 清单自身不算实现：表里写着「zq」不等于有人处理了 zq。
    if (entry === "shortcutsTable.ts") continue;
    out.push(full);
  }
  return out;
}

const SOURCES = sourceFiles(SRC).map((file) => ({
  file,
  text: readFileSync(file, "utf-8"),
}));

/** 按键名在代码里的几种写法：`escape` 既是对象键，也可能是 `event.key`。 */
function keyForms(key: string): string[] {
  switch (key) {
    case "escape":
      return ["escape", "Escape"];
    case "arrowleft":
      return ["arrowleft", "ArrowLeft"];
    case "arrowright":
      return ["arrowright", "ArrowRight"];
    case "arrowup":
      return ["arrowup", "ArrowUp"];
    case "arrowdown":
      return ["arrowdown", "ArrowDown"];
    case "pageup":
      return ["pageup", "PageUp"];
    case "pagedown":
      return ["pagedown", "PageDown"];
    case "space":
      return ["space", '" "'];
    case "home":
      return ["home", "Home"];
    case "end":
      return ["end", "End"];
    default:
      return [key, key.toUpperCase()];
  }
}

function hasHandler(combo: string): boolean {
  // 带修饰键的组合一定写成字符串键（useKeyboard 的表）。
  if (combo.includes("+")) {
    return SOURCES.some(({ text }) => text.includes(JSON.stringify(combo)));
  }
  for (const form of keyForms(combo)) {
    const quoted = form.startsWith('"') ? form : `"${form}"`;
    const found = SOURCES.some(({text}) => text.includes(quoted) ||
      text.split("\n").some(line => line.trimStart().startsWith(form+":")));
    if (found) return true;
  }
  return false;
}

describe("快捷键清单", () => {
  it("每一条都有对应的处理函数", () => {
    const missing = SHORTCUTS.filter((shortcut) => !hasHandler(shortcut.combo));
    expect(
      missing.map((shortcut) => `${shortcut.id} (${shortcut.combo})`),
    ).toEqual([]);
  });

  it("同一组里组合键不重复", () => {
    // 同一个键在不同组里说不同的事是正常的（图片组的「→」是翻页，
    // 视频组的「→」是快进五秒）；同一组里重复才是矛盾。
    const seen = new Map<string, number>();
    for (const shortcut of SHORTCUTS) {
      const key = `${shortcut.group}:${shortcut.combo}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const duplicated = [...seen.entries()].filter(([, count]) => count > 1);
    expect(duplicated).toEqual([]);
  });
});
