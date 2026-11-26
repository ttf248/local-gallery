import { forwardRef } from "react";
import { cx } from "./cx";
export type Status =
  "idle" | "running" | "paused" | "success" | "warning" | "failed";
export interface StatusDotProps {
  className?: string;
  status: Status;
  label: string;
  pulse?: boolean;
}
const tones: Record<Status, string> = {
  idle: "bg-ink-3",
  running: "bg-accent",
  paused: "bg-warning",
  success: "bg-success",
  warning: "bg-warning",
  failed: "bg-danger",
};
export const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(
  function StatusDot({ className, status, label, pulse }, forwardedRef) {
    return (
      <span
        ref={forwardedRef}
        className={cx("inline-flex items-center gap-2 text-label", className)}
      >
        <i
          aria-hidden="true"
          className={cx(
            "size-2 shrink-0 rounded-full",
            tones[status],
            pulse && "motion-safe:animate-pulse",
          )}
        />
        {label}
      </span>
    );
  },
);
