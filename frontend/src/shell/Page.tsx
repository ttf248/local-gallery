import type { ReactNode } from "react";
import { cx } from "../ui/cx";
export type PageVariant = "standard" | "gallery" | "focused" | "split";
export function Page({
  variant,
  children,
  className,
}: {
  variant: PageVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-page={variant}
      className={cx(
        "mx-auto w-full min-w-0 px-[var(--page-gutter)]",
        {
          standard: "max-w-[var(--page-max)]",
          gallery: "max-w-[var(--page-max-wide)]",
          focused: "max-w-[var(--page-max-focused)]",
          split: "max-w-[1280px]",
        }[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}
