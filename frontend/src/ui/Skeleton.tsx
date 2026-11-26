import {
  forwardRef,
  type CSSProperties,
  type ComponentPropsWithoutRef,
} from "react";
import { cx } from "./cx";
interface Props extends ComponentPropsWithoutRef<"div"> {
  shape?: "rect" | "text" | "circle";
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  ratio?: number;
}
export const Skeleton = forwardRef<HTMLDivElement, Props>(function Skeleton(
  { shape = "rect", width, height, ratio, style, className, ...props },
  ref,
) {
  return (
    <div
      data-skeleton=""
      aria-hidden="true"
      {...props}
      ref={ref}
      className={cx(
        "motion-safe:animate-[skeleton-light_1.6s_ease-in-out_infinite_alternate] bg-sunken",
        shape === "circle"
          ? "rounded-full"
          : shape === "text"
            ? "h-4 rounded-sm"
            : "rounded-tile",
        className,
      )}
      style={{ width, height, aspectRatio: ratio, ...style }}
    />
  );
});
