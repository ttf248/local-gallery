import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUIStore, type UIState } from "../../store/uiStore";
import { CloseIcon, InfoIcon, CheckIcon, AlertIcon } from "../../ui/icons";

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
    <div
      className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+12px)] z-toast mx-auto grid max-w-[480px] justify-items-center gap-2 lg:bottom-6"
      aria-live="polite"
    >
      {[...leaving, ...toasts].slice(-3).map((toast) => {
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
              "pointer-events-auto flex min-h-11 items-center gap-3 rounded-xl bg-inverse-bg px-4 py-2 text-callout text-inverse-fg shadow-2 " +
              (exiting ? "opacity-0 transition duration-2" : "fade-up")
            }
            aria-hidden={exiting || undefined}
            data-tone="inverse"
          >
            <Icon size={15} className="shrink-0" />
            <div className="max-w-80 flex-1 leading-snug">{toast.message}</div>
            {toast.action && (
              <button
                type="button"
                className="min-h-8 font-semibold underline"
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
              className="grid size-8 shrink-0 place-items-center"
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
