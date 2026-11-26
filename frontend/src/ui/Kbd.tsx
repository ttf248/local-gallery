import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";
export const Kbd = forwardRef<
  HTMLElement,
  ComponentPropsWithoutRef<"kbd"> & { keys: string[] }
>(function Kbd({ keys, className, ...props }, ref) {
  const command = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  return (
    <kbd
      {...props}
      ref={ref}
      className={cx(
        "rounded-md bg-sunken px-1.5 py-0.5 font-sans text-caption",
        className,
      )}
    >
      {keys.map((key) => (key === "Mod" ? command : key)).join(" + ")}
    </kbd>
  );
});
