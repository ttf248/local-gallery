// 快捷键的按键匹配。
//
// 快捷键清单（数据）在 shortcutsTable.ts —— 那一侧只有帮助浮层用，
// 而帮助浮层是按需加载的。这里放的是每个页面都要用的匹配逻辑。

// 保留控件激活、文本编辑和输入法行为，避免页面快捷键重复处理事件。
export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return true;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    )
  ) {
    return true;
  }
  return (
    (event.key === " " || event.key === "Enter") &&
    target.closest(
      'button, a[href], summary, [role="button"], [role="link"]',
    ) !== null
  );
}

/**
 * 页面上是否开着模态浮层。
 *
 * 浮层开着时 Esc 归浮层自己：大图预览、并排对比都各有一层，
 * 两层浮层抢同一个键会出现「关掉对比，顺手把背后的多选也关了」。
 */
export function hasOpenModal(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.querySelector('[role="dialog"][aria-modal="true"]') !== null
  );
}

// 规范化按键名为可比较字符串：ctrl+a / shift+arrowleft / F5 / space
export function normalizeKey(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");

  // 先归一特殊键名（+ / = / ? / 空格），再统一小写
  let k = e.key;
  // `?` 在 US 布局上是 Shift+/，但 AZERTY/QWERTZ 等布局可能是独立键。
  // 把它视作字面字符注册，忽略 shift 前缀；这样两种布局都能命中。
  if (k === "?") {
    parts.push("?");
    return parts.join("+");
  }
  if (k === " ") k = "space";
  // shift+= 在大多数键盘产生 e.key === '+'；handler 表里只用 '+'，
  // 旧实现会拼出 "shift+" 命中不到。这里把 + / = 统一归一为 '+'，
  // 并丢掉 shift 前缀（让 `+` / `=` 都能命中 '+' handler）。
  const isPlus = k === "+" || k === "=";
  if (isPlus) {
    k = "+";
  } else {
    k = k.toLowerCase();
    if (e.shiftKey) parts.push("shift");
  }
  parts.push(k);
  return parts.join("+");
}
