import { useEffect, type RefObject } from "react";

/**
 * 把键盘焦点关在一块浮层里。
 *
 * 抽屉、弹出层一类的浮层打开时，Tab 不该走到背景上去：背景上的控件
 * 看不见（被遮住），焦点却停在那里，用户按 Enter 会触发一个自己都
 * 看不见的动作。原生 `<dialog>.showModal()` 自带这个行为，本仓的
 * 模态框都走那一条路；移动端导航抽屉不是 dialog（它是一块滑入的
 * 侧栏），焦点陷阱得自己管。
 *
 * 只处理 Tab 与 Shift+Tab：其它键不拦，用户在抽屉里按 Esc 关闭、
 * 用方向键滚动都应当照常。
 */

/** 视口内可聚焦的元素。`tabindex="-1"` 的不算 —— 它们只能被脚本聚焦。 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** 元素当前是否可见（display:none 的元素不算可聚焦）。 */
function isVisible(element: HTMLElement): boolean {
  return (
    element.offsetWidth > 0 ||
    element.offsetHeight > 0 ||
    element.getClientRects().length > 0
  );
}

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter(isVisible);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      // 焦点不在浮层里（刚打开、或被脚本挪走）：从首尾接着走。
      if (!current || !root.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [ref, active]);
}
