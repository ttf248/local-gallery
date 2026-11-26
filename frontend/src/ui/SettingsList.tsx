import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cx } from "./cx";
interface GroupProps extends ComponentPropsWithoutRef<"section"> {
  title: string;
  description?: ReactNode;
}
export const SettingsGroup = forwardRef<HTMLElement, GroupProps>(
  function SettingsGroup(
    { title, description, children, className, ...props },
    ref,
  ) {
    return (
      <section
        {...props}
        ref={ref}
        className={cx("w-full max-w-[720px]", className)}
      >
        <h2 className="text-title-3">{title}</h2>
        {description && (
          <p className="mt-1 text-caption text-fg-muted">{description}</p>
        )}
        <div className="mt-3 rounded-2xl bg-bg-elevated pl-4 shadow-1">
          {children}
        </div>
      </section>
    );
  },
);
interface RowProps extends ComponentPropsWithoutRef<"div"> {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  htmlFor?: string;
}
export const SettingsRow = forwardRef<HTMLDivElement, RowProps>(
  function SettingsRow(
    { label, description, control, htmlFor, className, ...props },
    ref,
  ) {
    return (
      <div
        {...props}
        ref={ref}
        className={cx(
          "grid min-h-14 items-center gap-3 border-b border-line py-3 pr-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,.85fr)]",
          className,
        )}
      >
        <div>
          <label htmlFor={htmlFor} className="text-body">
            {label}
          </label>
          {description && (
            <p className="text-caption text-fg-muted">{description}</p>
          )}
        </div>
        <div className="min-w-0">{control}</div>
      </div>
    );
  },
);
