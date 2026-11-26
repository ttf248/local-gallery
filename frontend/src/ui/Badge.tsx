import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";
const tones = {
  neutral: ["bg-sunken text-ink-2", "bg-ink text-canvas"],
  accent: ["bg-accent-soft text-ink", "bg-accent text-on-accent"],
  success: ["bg-success/10 text-ink", "bg-success text-white"],
  warning: ["bg-warning/10 text-ink", "bg-warning text-white"],
  danger: ["bg-danger/10 text-ink", "bg-danger text-white"],
  favorite: ["bg-favorite/10 text-ink", "bg-favorite text-white"],
} as const;
interface Props extends ComponentPropsWithoutRef<"span"> {
  tone?: keyof typeof tones;
  variant?: "soft" | "solid" | "dot";
}
export const Badge = forwardRef<HTMLSpanElement, Props>(function Badge(
  { tone = "neutral", variant = "soft", className, ...props },
  ref,
) {
  if (variant === "dot")
    return (
      <span
        {...props}
        ref={ref}
        aria-hidden="true"
        className={cx(
          "inline-block size-2 shrink-0 rounded-full",
          tones[tone][1],
          className,
        )}
      />
    );
  return (
    <span
      {...props}
      ref={ref}
      className={cx(
        "inline-flex h-5 items-center gap-1 rounded-sm px-2 text-caption font-medium tabular-nums",
        tones[tone][variant === "soft" ? 0 : 1],
        className,
      )}
    />
  );
});

const feedbackLabels = { saving: "保存中", saved: "已保存", error: "保存失败" };
export function SaveBadge({
  status,
}: {
  status: "idle" | keyof typeof feedbackLabels;
}) {
  if (status === "idle") return null;
  return (
    <Badge
      role="status"
      aria-label={feedbackLabels[status]}
      tone={
        status === "saved"
          ? "success"
          : status === "error"
            ? "danger"
            : "neutral"
      }
    >
      {feedbackLabels[status]}
    </Badge>
  );
}
