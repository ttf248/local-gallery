import { cx } from "./cx";
import { forwardRef } from "react";
export interface ProgressRingProps {
  className?: string;
  value: number | null;
  size?: 16 | 24 | 40;
  label: string;
}
export const ProgressRing = forwardRef<SVGSVGElement, ProgressRingProps>(
  function ProgressRing({ className, value, size = 24, label }, forwardedRef) {
    const progress =
      value === null || !Number.isFinite(value)
        ? null
        : Math.min(100, Math.max(0, value));
    return (
      <svg
        ref={forwardedRef}
        role="progressbar"
        aria-label={label}
        aria-valuenow={progress ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={cx(
          progress === null ? "motion-safe:animate-spin" : undefined,
          className,
        )}
      >
        <g transform="rotate(-90 12 12)" fill="none" strokeWidth="2.5">
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            className="text-sunken-strong"
          />
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${progress ?? 25} 100`}
            className="text-accent"
          />
        </g>
      </svg>
    );
  },
);
