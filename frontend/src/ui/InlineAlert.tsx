import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";
import { Button } from "./Button";
interface Props extends ComponentPropsWithoutRef<"div"> {
  tone: "info" | "warning" | "danger";
  onRetry?: () => void;
  retrying?: boolean;
}
export const InlineAlert = forwardRef<HTMLDivElement, Props>(
  function InlineAlert(
    { tone, onRetry, retrying, children, className, ...props },
    ref,
  ) {
    return (
      <div
        role={tone === "danger" ? "alert" : "status"}
        {...props}
        ref={ref}
        className={cx(
          "flex items-center gap-3 rounded-md border-l-[3px] bg-sunken px-4 py-3",
          {
            info: "border-accent",
            warning: "border-warning",
            danger: "border-danger",
          }[tone],
          className,
        )}
      >
        <div className="flex-1">{children}</div>
        {onRetry && (
          <Button
            variant="secondary"
            size="sm"
            loading={retrying}
            onClick={onRetry}
          >
            重试
          </Button>
        )}
      </div>
    );
  },
);
