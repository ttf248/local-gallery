import { useRouteMeta } from "../app/routeMeta";
import type { ReactNode, HTMLAttributes } from "react";
import { cx } from "../ui/cx";
export type PageVariant = "standard" | "gallery" | "focused" | "workspace" | "system";
export function Page({
  variant: override,
  as: Tag = "div",
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "p";
  variant?: PageVariant;
  children: ReactNode;
  className?: string;
}) {
  const route = useRouteMeta();
  const variant = override ?? route?.meta.page ?? "standard";
  return (
    <Tag
      {...props}
      data-page={variant}
      className={cx(
        "mx-auto w-full min-w-0 px-gutter",
        {
          standard: "max-w-[var(--page-max)]",
          gallery: "max-w-none",
          focused: "max-w-[var(--page-max-focused)]",
          system: "max-w-[1200px]",
          workspace: "max-w-none",
        }[variant],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
