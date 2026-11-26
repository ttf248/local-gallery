import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";
export const ProgressBar = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div"> & { value?: number; label: string }
>(function ProgressBar({ value, label, className, ...props }, ref) {
  const progress =
    value === undefined || Number.isNaN(value)
      ? undefined
      : Math.max(0, Math.min(1, value));
  return (
    <div
      {...props}
      ref={ref}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={
        progress === undefined ? undefined : Math.round(progress * 100)
      }
      className={cx("h-1 overflow-hidden rounded-full bg-sunken-strong", className)}
    >
      <div
        className={cx(
          "h-full rounded-full bg-accent",
          progress === undefined && "indeterminate",
        )}
        style={{ width: progress === undefined ? "35%" : progress * 100 + "%" }}
      />
    </div>
  );
});
