import { forwardRef } from "react";
import type { ReactNode } from "react";
import { cx } from "./cx";

export interface StatProps {
  className?: string;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "neutral" | "danger" | "success";
}
export const Stat = forwardRef<HTMLDListElement, StatProps>(function Stat(
  { className, label, value, hint, tone = "neutral" },
  forwardedRef,
) {
  return (
    <dl ref={forwardedRef} className={cx("min-w-0", className)}>
      <dt className="text-caption text-ink-2">{label}</dt>
      <dd
        className={cx(
          "m-0 text-title tabular-nums",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </dd>
      {hint && <dd className="m-0 text-caption text-ink-3">{hint}</dd>}
    </dl>
  );
});
