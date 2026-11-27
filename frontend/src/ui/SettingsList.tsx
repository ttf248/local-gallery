import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cx } from "./cx";
interface GroupProps extends ComponentPropsWithoutRef<"section"> {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  description?: ReactNode;
}
export const SettingsGroup = forwardRef<HTMLElement, GroupProps>(
  function SettingsGroup(
    {
      title,
      icon,
      id,
      actions,
      flush = true,
      description,
      children,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <section
        {...props}
        ref={ref}
        id={id}
        aria-labelledby={id ? id + "-heading" : undefined}
        className={cx(
          "[container-type:inline-size] [container-name:settings-card] min-w-0 w-full rounded-xl border border-line bg-raised p-4 sm:p-5",
          !flush && "mb-4",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <h2
            id={id ? id + "-heading" : undefined}
            className="flex items-center gap-2 text-body font-semibold text-ink"
          >
            {icon && <span aria-hidden="true">{icon}</span>}
            {title}
          </h2>
          {actions && <div className="text-caption text-ink-2">{actions}</div>}
        </div>
        {description && (
          <p className="mt-1 text-caption text-ink-2">{description}</p>
        )}
        <div className="mt-2">{children}</div>
      </section>
    );
  },
);
interface RowProps extends ComponentPropsWithoutRef<"div"> {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  danger?: boolean;
  htmlFor?: string;
}
export const SettingsRow = forwardRef<HTMLDivElement, RowProps>(
  function SettingsRow(
    {
      label,
      description,
      control,
      children,
      danger,
      htmlFor,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <div
        {...props}
        ref={ref}
        data-setting-row=""
        className={cx(
          "grid min-h-11 items-center gap-3 border-b border-line-subtle py-1.5 last:border-0 sm:grid-cols-[minmax(0,min(42%,14rem))_minmax(0,1fr)] [@container_settings-card_(max-width:26rem)]:has-[[role=radiogroup]]:grid-cols-1 has-[[role=switch]]:grid-cols-[minmax(0,min(55%,18rem))_auto]",
          danger && "rounded-md border border-danger/30 p-3",
          className,
        )}
      >
        <div>
          <label htmlFor={htmlFor} className="text-body">
            {label}
          </label>
          {description && (
            <p className="text-caption text-ink-2">{description}</p>
          )}
        </div>
        <div className="min-w-0">{control ?? children}</div>
      </div>
    );
  },
);
