import { cx } from "./cx";
import { forwardRef } from "react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";
import { IconButton } from "./IconButton";
export interface InspectorProps {
  className?: string;
  open: boolean;
  closeLabel?:string;
  "data-testid"?: string;
  title: string;
  onClose: () => void;
  width?: 320 | 360 | 400;
  children: ReactNode;
}
export const Inspector = forwardRef<HTMLElement, InspectorProps>(
  function Inspector(
    { className, open, title, onClose, width = 360, children, closeLabel="关闭信息面板", ...props },
    forwardedRef,
  ) {
    const id = useId(),
      panel = useRef<HTMLElement | null>(null);
    useEffect(() => {
      if (!open) return;
      const previous = document.activeElement;
      panel.current?.querySelector<HTMLElement>("button")?.focus();
      return () => {
        if (previous instanceof HTMLElement && previous.isConnected)
          previous.focus();
      };
    }, [open]);
    if (!open) return null;
    return (
      <aside {...props}
        ref={(node) => {
          panel.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        aria-labelledby={id}
        style={{ width }}
        className={cx(
          "max-w-full shrink-0 overflow-y-auto border-l border-line bg-raised p-4",
          className,
        )}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.defaultPrevented) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 id={id} className="text-heading">
            {title}
          </h2>
          <IconButton label={closeLabel} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </header>
        {children}
      </aside>
    );
  },
);
