import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cx } from "./cx";
interface Props extends ComponentPropsWithoutRef<"section"> {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "error";
  size?: "page" | "inline" | "compact";
}
export const EmptyState = forwardRef<HTMLElement, Props>(function EmptyState(
  {
    title,
    description,
    action,
    icon,
    tone = "neutral",
    size = "page",
    className,
    ...props
  },
  ref,
) {
  return (
    <section
      {...props}
      ref={ref}
      className={cx(
        "flex flex-col gap-3",
        size === "page"
          ? "min-h-[45vh] items-center justify-center text-center"
          : size === "compact"
            ? "items-center py-6 text-center"
            : "items-start py-4",
        className,
      )}
    >
      {icon && (
        <span
          aria-hidden="true"
          className="grid size-12 place-items-center rounded-full bg-sunken text-ink-2"
        >
          {icon}
        </span>
      )}
      <h2 className={cx("text-heading", tone === "error" && "text-danger")}>
        {title}
      </h2>
      {description && (
        <div className="max-w-[420px] text-body text-ink-2">{description}</div>
      )}
      {action}
    </section>
  );
});
