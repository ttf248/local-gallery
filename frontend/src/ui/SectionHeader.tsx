import { forwardRef } from "react";
import type { ReactNode } from "react";
import { cx } from "./cx";
export interface SectionHeaderProps {
  className?: string;
  title: string;
  count?: number | string;
  description?: ReactNode;
  action?: ReactNode;
  as?: "h2" | "h3";
  sticky?: boolean;
}
export const SectionHeader = forwardRef<HTMLElement, SectionHeaderProps>(
  function SectionHeader(
    {
      className,
      title,
      count,
      description,
      action,
      as: Heading = "h2",
      sticky,
    },
    forwardedRef,
  ) {
    return (
      <header
        ref={forwardedRef}
        className={cx(
          "flex min-w-0 items-center justify-between gap-4 py-2",
          sticky && "sticky top-[var(--sticky-offset,var(--topbar-h))] z-toolbar bg-canvas/95 backdrop-blur",
          className,
        )}
      >
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <Heading className="truncate text-heading">{title}</Heading>
            {count !== undefined && (
              <span className="text-caption tabular-nums text-ink-3">
                {count}
              </span>
            )}
          </div>
          {description && (
            <div
              className="truncate text-caption text-ink-2"
              title={typeof description === "string" ? description : undefined}
            >
              {description}
            </div>
          )}
        </div>
        {action}
      </header>
    );
  },
);
