import { cx } from "./cx";
import { forwardRef } from "react";
import { useId, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "./icons";
export interface DisclosureProps {
  className?: string;
  summary: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}
export const Disclosure = forwardRef<HTMLDivElement, DisclosureProps>(
  function Disclosure(
    { className, summary, defaultOpen = false, children },
    forwardedRef,
  ) {
    const [open, setOpen] = useState(defaultOpen);
    const id = useId();
    return (
      <div ref={forwardedRef}>
        <button
          type="button"
          aria-controls={id}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={cx(
            "flex min-h-9 w-full items-center justify-between gap-2 text-left text-label touch:min-h-10",
            className,
          )}
        >
          {summary}
          <ChevronDownIcon
            aria-hidden="true"
            size={16}
            className={open ? "rotate-180" : undefined}
          />
        </button>
        <div id={id} hidden={!open}>
          {children}
        </div>
      </div>
    );
  },
);
