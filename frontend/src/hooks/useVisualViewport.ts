import { useEffect } from "react";

/**
 * 跟踪软键盘占掉的高度。
 *
 * 移动端浏览器弹出软键盘时，布局视口不变，可视视口变矮 —— 于是贴底
 * 的浮层（多选条、扫描卡）被键盘压在下面，看得见却点不到。
 * `visualViewport` 报告的就是可视视口；它与布局视口之差就是键盘
 * 吃掉的那一段。
 *
 * 把这段高度写进 `--keyboard-inset`，并给根节点打上 `data-keyboard`：
 * 贴底浮层据此上移。没有软键盘时（桌面浏览器）差值为 0，一切照旧。
 *
 * 明确不做的事：整页重排、输入框浮动定位 —— 本仓没有贴底的输入框，
 * 键盘弹出时正文被顶上去反而更难读。
 */

/** 差值超过这个值才算「键盘开着」：地址栏收起 / 展开也会改变可视视口。 */
const KEYBOARD_THRESHOLD_PX = 120;

export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const inset = Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
      );
      const root = document.documentElement;
      root.style.setProperty("--keyboard-inset", `${inset}px`);
      if (inset > KEYBOARD_THRESHOLD_PX) {
        root.setAttribute("data-keyboard", "true");
      } else {
        root.removeAttribute("data-keyboard");
      }
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      const root = document.documentElement;
      root.removeAttribute("data-keyboard");
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}
