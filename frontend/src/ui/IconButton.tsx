import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Tooltip } from "./Tooltip";
import { cx } from "./cx";
interface Props extends ComponentPropsWithoutRef<"button"> {
  label: string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "secondary" | "overlay";
  pressed?: boolean;
}
export const IconButton = forwardRef<HTMLButtonElement, Props>(
  function IconButton(
    { label, size = "md", variant = "ghost", pressed, className, ...props },
    ref,
  ) {
    return (
      <Tooltip content={label}>
        <button
          type="button"
          {...props}
          ref={ref}
          aria-label={label}
          aria-pressed={pressed}
          className={cx(
            "touch:min-h-10 touch:min-w-10 relative inline-grid shrink-0 place-items-center rounded-md transition duration-fast aria-pressed:bg-accent-soft disabled:opacity-40",
            {
              sm: "size-7 [&_svg]:size-4",
              md: "size-8 [&_svg]:size-[18px]",
              lg: "size-10 [&_svg]:size-5",
            }[size],
            {
              ghost: "hover:bg-hover",
              secondary: "border border-line-strong hover:bg-hover",
              overlay: "bg-black/40 text-white backdrop-blur-md",
            }[variant],
            className,
          )}
        />
      </Tooltip>
    );
  },
);
