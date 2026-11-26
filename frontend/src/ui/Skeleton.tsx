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
      aria-hidden="true"
      {...props}
      ref={ref}
      className={cx(
        "skeleton bg-bg-subtle",
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
