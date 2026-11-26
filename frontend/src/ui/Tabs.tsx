import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";
interface Tab {
  id: string;
  label: ReactNode;
  href?: string;
  count?: number;
}
interface Props extends Omit<ComponentPropsWithoutRef<"div">, "onChange"> {
  items: Tab[];
  as?: "nav" | "div";
  variant?: "underline" | "pill";
  value: string;
  onChange?: (id: string) => void;
  orientation?: "vertical" | "horizontal";
  label: string;
  idPrefix?: string;
}
export const Tabs = forwardRef<HTMLDivElement, Props>(function Tabs(
  {
    items,
    as,
    variant = "underline",
    value,
    onChange,
    orientation = "horizontal",
    label,
    idPrefix,
    className,
    ...props
  },
  ref,
) {
  const generated = useId(),
    prefix = idPrefix ?? generated,
    vertical = orientation === "vertical",
    links = as === "nav" || items.every((item) => item.href);
  return (
    <div
      {...props}
      ref={ref}
      role={links ? "navigation" : "tablist"}
      aria-orientation={links ? undefined : orientation}
      aria-label={label}
      data-variant={variant}
      className={cx("flex gap-1", vertical && "flex-col", className)}
    >
      {items.map(({ id, label: caption, href, count }, i) => {
        const selected = id === value;
        const style = cx(
          "relative inline-flex min-h-9 min-w-8 shrink-0 items-center whitespace-nowrap touch:min-h-10 touch:min-w-10 gap-2 px-3 text-label transition duration-base",
          selected ? "text-ink" : "text-ink-2 hover:text-ink",
          variant === "pill" || vertical ? "rounded-md" : "border-b-2",
          selected
            ? variant === "pill" || vertical
              ? "bg-raised shadow-1"
              : "border-ink"
            : "border-transparent",
        );
        const content = (
          <>
            {caption}
            {count !== undefined && (
              <span
                aria-hidden="true"
                className={cx(
                  "text-caption tabular-nums",
                  selected ? "text-ink-2" : "text-ink-3",
                )}
              >
                {count}
              </span>
            )}
          </>
        );
        if (href)
          return (
            <Link
              key={id}
              to={href}
              aria-current={selected ? "page" : undefined}
              className={style}
            >
              {content}
            </Link>
          );
        return (
          <button
            type="button"
            role="tab"
            key={id}
            id={prefix + "-tab-" + id}
            aria-controls={prefix + "-panel-" + id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={style}
            onClick={() => onChange?.(id)}
            onKeyDown={(event) => {
              const next = vertical ? "ArrowDown" : "ArrowRight",
                prev = vertical ? "ArrowUp" : "ArrowLeft";
              const target =
                event.key === next
                  ? (i + 1) % items.length
                  : event.key === prev
                    ? (i + items.length - 1) % items.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? items.length - 1
                        : undefined;
              if (target === undefined) return;
              event.preventDefault();
              onChange?.(items[target].id);
              document
                .getElementById(prefix + "-tab-" + items[target].id)
                ?.focus();
            }}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
});
