import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { useEdgeFade } from "./useEdgeFade";
import { cx } from "./cx";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
interface Props extends ComponentPropsWithoutRef<"div"> {
  label: string;
  gap?: number;
  snap?: boolean;
}
export const ScrollRow = forwardRef<HTMLDivElement, Props>(function ScrollRow(
  { label, gap = 16, snap = true, children, className, style, ...props },
  forwardedRef,
) {
  const { ref, fade, maskImage } = useEdgeFade<HTMLDivElement>();
  function scroll(direction: number) {
    const row = ref.current;
    if (!row) return;
    row.scrollBy({
      left: row.clientWidth * 0.85 * direction,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  return (
    <div className={cx("group relative min-w-0", className)}>
      <div
        {...props}
        ref={(el) => {
          ref.current = el;
          if (typeof forwardedRef === "function") forwardedRef(el);
          else if (forwardedRef) forwardedRef.current = el;
        }}
        role="region"
        aria-label={label}
        tabIndex={0}
        style={{ gap, maskImage, ...style }}
        className={cx(
          "flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          snap && "snap-x snap-proximity [&>*]:snap-start",
        )}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            scroll(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        {children}
      </div>
      {([-1, 1] as const).map(
        (direction) =>
          (direction < 0 ? fade.start : fade.end) && (
            <button
              type="button"
              key={direction}
              aria-label={direction < 0 ? "向左滚动" : "向右滚动"}
              className={cx(
                "touch:hidden absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-raised opacity-0 shadow-2 transition-opacity focus:opacity-100 group-hover:opacity-100",
                direction < 0 ? "left-1" : "right-1",
              )}
              onClick={() => scroll(direction)}
            >
              {direction < 0 ? <ChevronLeftIcon /> : <ChevronRightIcon />}
            </button>
          ),
      )}
    </div>
  );
});
