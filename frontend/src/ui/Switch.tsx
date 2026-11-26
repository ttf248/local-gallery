import { forwardRef, useId, type ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";
interface Props extends Omit<ComponentPropsWithoutRef<"button">, "onChange"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}
export const Switch = forwardRef<HTMLButtonElement, Props>(function Switch(
  { checked, onChange, label, description, className, ...props },
  ref,
) {
  const id = useId();
  return (
    <button
      type="button"
      {...props}
      ref={ref}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      aria-describedby={description ? id : undefined}
      onClick={() => onChange(!checked)}
      className={cx(
        "group inline-flex h-10 w-10 shrink-0 items-center rounded-full disabled:opacity-40",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="relative h-6 w-10 rounded-full bg-sunken-strong transition-colors group-aria-checked:bg-accent"
      >
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-1 transition-transform duration-base group-aria-checked:translate-x-4" />
      </span>
      {description && (
        <span className="sr-only" id={id}>
          {description}
        </span>
      )}
    </button>
  );
});
