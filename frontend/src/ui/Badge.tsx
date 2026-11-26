import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";
const tones = {
  neutral: ["bg-bg-subtle text-fg-muted", "bg-fg text-bg"],
  signal: ["bg-signal-soft text-fg", "bg-signal text-white"],
  success: ["bg-success/10 text-fg", "bg-success text-white"],
  warning: ["bg-warning/10 text-fg", "bg-warning text-white"],
  danger: ["bg-danger/10 text-fg", "bg-danger text-white"],
  favorite: ["bg-favorite/10 text-fg", "bg-favorite text-white"],
} as const;
interface Props extends ComponentPropsWithoutRef<"span"> {
  tone?: keyof typeof tones;
  variant?: "soft" | "solid";
}
export const Badge = forwardRef<HTMLSpanElement, Props>(function Badge(
  { tone = "neutral", variant = "soft", className, ...props },
  ref,
) {
  return (
    <span
      {...props}
      ref={ref}
      className={cx(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-micro tabular-nums",
        tones[tone][variant === "soft" ? 0 : 1],
        className,
      )}
    />
  );
});
