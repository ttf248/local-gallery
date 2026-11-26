import { useCallback, useEffect, useRef } from "react";
export interface ZoomRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function fitRect(
  mediaRatio: number,
  viewport: ZoomRect,
  padding: number,
): ZoomRect {
  const ratio = Number.isFinite(mediaRatio) && mediaRatio > 0 ? mediaRatio : 1;
  const width = Math.max(
      0,
      Math.min(
        viewport.width - 2 * padding,
        (viewport.height - 2 * padding) * ratio,
      ),
    ),
    height = width / ratio;
  return {
    x: viewport.x + (viewport.width - width) / 2,
    y: viewport.y + (viewport.height - height) / 2,
    width,
    height,
  };
}
export function flipTransform(from: ZoomRect, to: ZoomRect) {
  return (
    "translate(" +
    (from.x - to.x) +
    "px, " +
    (from.y - to.y) +
    "px) scale(" +
    from.width / to.width +
    ", " +
    from.height / to.height +
    ")"
  );
}
export function useZoomTransition({
  getSourceRect,
  reducedMotion,
}: {
  getSourceRect: () => ZoomRect | null;
  reducedMotion: boolean;
}) {
  const animation = useRef<Animation | null>(null),
    ratio = useRef(1);
  useEffect(
    () => () => {
      animation.current?.cancel();
    },
    [],
  );
  const run = useCallback(
    async (el: HTMLElement, opening: boolean) => {
      const rect = getSourceRect(),
        visible =
          rect &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.x < innerWidth &&
          rect.y < innerHeight &&
          rect.x + rect.width > 0 &&
          rect.y + rect.height > 0;
      const bounds = el.getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(el).paddingLeft) || 0;
      const target = fitRect(
        ratio.current > 0 && Number.isFinite(ratio.current)
          ? ratio.current
          : rect
            ? rect.width / rect.height
            : 1,
        bounds,
        padding,
      );
      const flip =
        visible && target.width > 0 && target.height > 0 && !reducedMotion;
      // 变换原点放在画面内容的左上角，保留 contain 产生的留白。
      const origin = target.x - bounds.x + "px " + (target.y - bounds.y) + "px";
      const source: Keyframe = reducedMotion
        ? { opacity: 0 }
        : flip
          ? { transform: flipTransform(rect, target), transformOrigin: origin }
          : { opacity: 0, transform: "scale(.96)" };
      const dest: Keyframe = reducedMotion
        ? { opacity: 1 }
        : { opacity: 1, transform: "none", transformOrigin: origin };
      animation.current?.finish();
      if (!el.animate) return;
      const next = el.animate(opening ? [source, dest] : [dest, source], {
        duration: reducedMotion ? 150 : flip ? 360 : 200,
        easing: "cubic-bezier(.3,0,0,1)",
      });
      animation.current = next;
      try {
        await next.finished;
      } catch {
        /* 卸载取消当前动画。 */
      } finally {
        if (animation.current === next) animation.current = null;
      }
    },
    [getSourceRect, reducedMotion],
  );
  const enter = useCallback(
    (el: HTMLElement, mediaRatio: number) => {
      ratio.current = mediaRatio;
      return run(el, true);
    },
    [run],
  );
  const exit = useCallback((el: HTMLElement) => run(el, false), [run]);
  return { enter, exit };
}
