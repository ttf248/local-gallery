import { useEffect, useState } from "react";

/** 视口外多渲染一点的余量（像素）：滚动时不会看到空格子。 */
const OVERSCAN = 600;

interface VisibleWindow {
  /** 容器内坐标系里的可见区间。 */
  top: number;
  bottom: number;
}

/**
 * 找出最近的可滚动祖先。
 *
 * 照片墙铺在主区里，主区自己滚动；页面本身不滚。找不到可滚动祖先时
 * （静态渲染、测试环境）返回 null，调用方据此把整块都算作可见。
 */
function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * 容器在滚动视口里的可见区间。
 *
 * 瀑布流一次可能排到几千张：全量渲染会让 DOM 撑爆，滚动也会卡。这段
 * 只把视口附近的那几张挂上去，其余的留白 —— 照片墙因此始终只有几十个
 * 节点在 DOM 里。
 *
 * 传入的是元素本身而不是 ref：ref 的身份每次渲染都可能变（回调 ref
 * 每次都是新的），拿它当依赖会变成「渲染 → 重新测量 → 再渲染」的
 * 死循环。
 */
export function useVisibleWindow(
  element: HTMLElement | null,
  height: number,
): VisibleWindow {
  const [visible, setVisible] = useState<VisibleWindow>({ top: 0, bottom: 0 });

  useEffect(() => {
    if (!element) return;
    const scroller = findScrollParent(element);
    if (!scroller) {
      // 没有可滚动的祖先：整块都在视野里。
      setVisible({ top: 0, bottom: height });
      return;
    }
    const update = () => {
      const rect = element.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const top = scrollerRect.top - rect.top;
      setVisible({
        top: top - OVERSCAN,
        bottom: top + scroller.clientHeight + OVERSCAN,
      });
    };
    update();
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [element, height]);

  return visible;
}
