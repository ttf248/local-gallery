import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cx } from "./cx";
interface GroupProps extends ComponentPropsWithoutRef<"section"> {
  title: string;
  icon?: ReactNode;
  description?: ReactNode;
}
export const SettingsGroup = forwardRef<HTMLElement, GroupProps>(
  function SettingsGroup(
    { title, icon, id, description, children, className, ...props },
    ref,
  ) {
    return (
      <section
        {...props}
        ref={ref}
        id={id}
        aria-labelledby={id ? id + "-heading" : undefined}
        className={cx("mb-7 w-full", className)}
      >
        <h2
          id={id ? id + "-heading" : undefined}
          className="flex items-center gap-2 text-heading"
        >
          {icon && <span aria-hidden="true">{icon}</span>}
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-caption text-ink-2">{description}</p>
        )}
        <div className="mt-3 rounded-2xl bg-raised pl-4 shadow-1">
          {children}
        </div>
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
          "grid min-h-14 items-center gap-3 border-b border-line py-3 pr-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,.85fr)]",
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
