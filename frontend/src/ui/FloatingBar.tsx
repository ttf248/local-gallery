import { cx } from "./cx";
import { forwardRef } from "react";
import { useEffect, type ReactNode } from "react";
import { IconButton } from "./IconButton";
import { CloseIcon } from "./icons";
export interface FloatingBarProps {
  className?: string;
  open: boolean;
  label: string;
  summary: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}
export const FloatingBar = forwardRef<HTMLElement, FloatingBarProps>(
  function FloatingBar(
    { className, open, label, summary, actions, onClose },
    forwardedRef,
  ) {
    useEffect(() => {
      if (!open) return;
      const dismiss = (event: KeyboardEvent) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !document.querySelector("dialog[open]")
        ) {
          event.preventDefault();
          onClose();
        }
      };
      window.addEventListener("keydown", dismiss);
      return () => window.removeEventListener("keydown", dismiss);
    }, [open, onClose]);
    if (!open) return null;
    return (
      <section
        data-floating-bar="" ref={forwardedRef}
        aria-label={label}
        className={cx(
          "fixed inset-x-0 bottom-[calc(var(--tabbar-height)+var(--float-bottom))] z-floatingbar min-h-[52px] mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center gap-3 rounded-xl bg-inverse px-3 py-2 text-on-inverse shadow-3 lg:bottom-5",
          className,
        )}
      >
        <span className="text-label">{summary}</span>
        {actions}
        <IconButton label="关闭" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </section>
    );
  },
);
