import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cx } from "./cx";

interface TextProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
  hint?: string;
  error?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}
export const TextField = forwardRef<HTMLInputElement, TextProps>(
  function TextField(
    { label, hint, error, id, leading, trailing, className, ...props },
    ref,
  ) {
    const generated = useId();
    const inputId = id ?? generated;
    return (
      <div className={cx("grid gap-1.5", className)}>
        <label htmlFor={inputId} className="text-label">
          {label}
        </label>
        <div className="flex h-9 min-w-0 items-center gap-2 rounded-md bg-sunken px-3 focus-within:bg-canvas focus-within:shadow-focus">
          {leading}
          <input
            {...props}
            ref={ref}
            className="h-full min-w-0 flex-1 bg-transparent outline-none"
            id={inputId}
            aria-invalid={Boolean(error)}
            aria-describedby={
              error || hint ? inputId + "-hint" : props["aria-describedby"]
            }
          />
          {trailing}
        </div>
        {(error || hint) && (
          <p
            className={
              error ? "text-caption text-danger" : "text-caption text-ink-2"
            }
            id={inputId + "-hint"}
          >
            {error || hint}
          </p>
        )}
      </div>
    );
  },
);
