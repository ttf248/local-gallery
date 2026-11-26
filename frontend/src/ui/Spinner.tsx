import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";
export const Spinner = forwardRef<
  HTMLSpanElement,
  ComponentPropsWithoutRef<"span">
>(function Spinner({ className, ...props }, ref) {
  return (
    <span
      aria-hidden="true"
      {...props}
      ref={ref}
      className={cx(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent",
        className,
      )}
    />
  );
});
