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
  tone?: "neutral" | "error";
  size?: "page" | "inline";
}
export const EmptyState = forwardRef<HTMLElement, Props>(function EmptyState(
  {
    title,
    description,
    action,
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
          : "items-start py-4",
        className,
      )}
    >
      <h2
        className={cx(
          size === "page" ? "text-title-2" : "text-title-3",
          tone === "error" && "text-danger",
        )}
      >
        {title}
      </h2>
      {description && (
        <p className="max-w-[440px] text-body text-fg-muted">{description}</p>
      )}
      {action}
    </section>
  );
});
