import { useRouteMeta } from "../app/routeMeta";
import type { ReactNode } from "react";
import { cx } from "../ui/cx";
export type PageVariant = "standard" | "gallery" | "focused" | "workspace";
export function Page({
  variant: override,
  children,
  className,
}: {
  variant?: PageVariant;
  children: ReactNode;
  className?: string;
}) {
  const route = useRouteMeta();
  const variant = override ?? route?.meta.page ?? "standard";
  return (
    <div
      data-page={variant}
      className={cx(
        "mx-auto w-full min-w-0 px-[var(--gutter)]",
        {
          standard: "max-w-[var(--page-max)]",
          gallery: "max-w-none",
          focused: "max-w-[var(--page-max-focused)]",
          workspace: "max-w-none",

        }[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}
