import { forwardRef } from "react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "./cx";
export interface ToolbarProps {
  label: string;
  start?: ReactNode;
  end?: ReactNode;
  children?: ReactNode;
  className?: string;
}
const selector =
  'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[role="button"]:not([aria-disabled="true"])';
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(
  function Toolbar({ label, start, end, children, className }, forwardedRef) {
    const root = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
      const bar = root.current;
      if (!bar) return;
      const initial = new Map<HTMLElement, string | null>();
      function sync() {
        if (!bar) return;
        const controls = Array.from(
          bar.querySelectorAll<HTMLElement>(selector),
        ).filter((el) => !el.closest("[hidden],[inert]"));
        const active =
          controls.find((el) => el === document.activeElement) ??
          controls.find((el) => el.tabIndex === 0) ??
          controls[0];
        for (const el of controls) {
          if (!initial.has(el)) initial.set(el, el.getAttribute("tabindex"));
          el.tabIndex = el === active ? 0 : -1;
        }
      }
      sync();
      const observer = new MutationObserver(sync);
      observer.observe(bar, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled", "hidden", "inert"],
      });
      bar.addEventListener("focusin", sync);
      return () => {
        observer.disconnect();
        bar.removeEventListener("focusin", sync);
        for (const [el, tab] of initial) {
          if (tab === null) el.removeAttribute("tabindex");
          else el.setAttribute("tabindex", tab);
        }
      };
    }, []);
    return (
      <div
        ref={(node) => {
          root.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        role="toolbar"
        aria-label={label}
        className={cx("min-w-0 bg-canvas", className)}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey ||
            (event.target instanceof HTMLElement &&
              event.target.matches(
                "input,textarea,select,[contenteditable=true]",
              ))
          )
            return;
          const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
          if (!keys.includes(event.key)) return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(selector),
          ).filter((el) => !el.closest("[hidden],[inert]"));
          const index = controls.indexOf(document.activeElement as HTMLElement);
          if (index < 0) return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? controls.length - 1
                : (index +
                    (event.key === "ArrowLeft" ? -1 : 1) +
                    controls.length) %
                  controls.length;
          controls[next]?.focus();
        }}
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {start}
          </div>
          {end && (
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {end}
            </div>
          )}
        </div>
        {children && (
          <div className="flex flex-wrap gap-2 pb-2">{children}</div>
        )}
      </div>
    );
  },
);
export function ToolbarGroup({
  children,
  separated,
}: {
  children: ReactNode;
  separated?: boolean;
}) {
  return (
    <div
      className={cx(
        "inline-flex items-center gap-1",
        separated && "ml-1 border-l border-line pl-2",
      )}
    >
      {children}
    </div>
  );
}
