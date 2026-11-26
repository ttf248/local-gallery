import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { variants } from "./variants";
import { Spinner } from "./Spinner";
const styles = variants({
  base: "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-control px-4 transition duration-1 enabled:active:scale-[.98] disabled:cursor-default disabled:opacity-40",
  variants: {
    variant: {
      primary: "bg-accent text-accent-contrast",
      secondary: "border border-line-strong hover:bg-bg-subtle",
      ghost: "hover:bg-bg-subtle",
      danger: "text-danger hover:bg-danger/10",
    },
    size: {
      sm: "h-8 text-callout",
      md: "h-10 text-body",
      lg: "h-12 text-body",
    },
  },
  defaults: { variant: "primary", size: "md" },
});
export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant,
      size,
      loading,
      disabled,
      leadingIcon,
      trailingIcon,
      children,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <button
        type="button"
        {...props}
        ref={ref}
        disabled={loading || disabled}
        aria-busy={loading || undefined}
        className={styles({ variant, size, className })}
      >
        <span
          className={
            "inline-flex items-center gap-2" + (loading ? " invisible" : "")
          }
        >
          {leadingIcon}
          {children}
          {trailingIcon}
        </span>
        {loading && <Spinner className="absolute" />}
      </button>
    );
  },
);
