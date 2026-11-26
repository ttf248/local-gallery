import { forwardRef } from "react";
import { CloseIcon } from "./icons";
import { cx } from "./cx";
export interface FilterChipProps {
  className?: string;
  label: string;
  onRemove: () => void;
  tone?: "neutral" | "accent";
}
export const FilterChip = forwardRef<HTMLButtonElement, FilterChipProps>(
  function FilterChip(
    { className, label, onRemove, tone = "neutral" },
    forwardedRef,
  ) {
    return (
      <button
        ref={forwardedRef}
        type="button"
        aria-label={`移除筛选：${label}`}
        onClick={onRemove}
        onKeyDown={(e) => {
          if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            onRemove();
          }
        }}
        className={cx(
          "inline-flex min-h-8 items-center gap-1 rounded-sm px-2 text-label touch:min-h-10",
          tone === "accent"
            ? "bg-accent-soft text-accent-text"
            : "bg-sunken text-ink-2 hover:bg-hover",
          className,
        )}
      >
        {label}
        <CloseIcon size={16} aria-hidden="true" />
      </button>
    );
  },
);
