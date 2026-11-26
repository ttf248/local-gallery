import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUIStore, type UIState } from "../../store/uiStore";
import { CloseIcon, InfoIcon, CheckIcon, AlertIcon } from "./Icon";

export default function ToastViewport() {
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismissToast);
  const previous = useRef(toasts);
  const [leaving, setLeaving] = useState<UIState["toasts"]>([]);

  useLayoutEffect(() => {
    const active = new Set(toasts.map(({ id }) => id));
    const removed = previous.current.filter(({ id }) => !active.has(id));
    previous.current = toasts;
    if (removed.length) setLeaving((items) => [...items, ...removed]);
  }, [toasts]);

  useEffect(() => {
    if (!leaving.length) return;
    const timeout = window.setTimeout(() => setLeaving([]), 200);
    return () => window.clearTimeout(timeout);
  }, [leaving]);

  if (!toasts.length && !leaving.length) return null;

  return (
    <div className="toast-viewport float-bottom" aria-live="polite">
      {[...toasts, ...leaving].map((toast) => {
        const exiting = leaving.includes(toast);
        const Icon =
          toast.kind === "success"
            ? CheckIcon
            : toast.kind === "error" || toast.kind === "warning"
              ? AlertIcon
              : InfoIcon;
        return (
          <div
            key={toast.id}
            className={
              exiting
                ? "toast-message toast-message--leaving"
                : "toast-message fade-up"
            }
            aria-hidden={exiting || undefined}
            data-tone="reader"
          >
            <Icon size={15} className="shrink-0" />
            <div className="max-w-80 flex-1 leading-snug">{toast.message}</div>
            {toast.action && (
              <button
                type="button"
                className="ui-btn font-semibold"
                disabled={exiting}
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              className="toolbar-icon shrink-0"
              aria-label="关闭"
              disabled={exiting}
              onClick={() => dismiss(toast.id)}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
