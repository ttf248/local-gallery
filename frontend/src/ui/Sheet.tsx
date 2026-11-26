import { forwardRef, useRef } from "react";
import { ModalSurface, type ModalProps } from "./ModalSurface";
import { cx } from "./cx";
interface Props extends ModalProps {
  side: "left" | "right" | "bottom";
  label: string;
}
export const Sheet = forwardRef<HTMLDialogElement, Props>(function Sheet(
  { side, label, children, onClose, className, ...props },
  ref,
) {
  const start = useRef<{ y: number; time: number } | null>(null);
  return (
    <ModalSurface
      {...props}
      ref={ref}
      aria-label={label}
      onClose={onClose}
      data-side={side}
      className={cx(
        "modal-surface sheet-surface p-5",
        side === "bottom"
          ? "inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-full rounded-t-xl pb-[max(20px,env(safe-area-inset-bottom))]"
          : "inset-y-0 m-0 h-dvh max-h-dvh w-[clamp(320px,34vw,400px)] max-w-full",
        side === "left" && "left-0 right-auto rounded-r-xl",
        side === "right" && "left-auto right-0 rounded-l-xl",
        className,
      )}
    >
      {side === "bottom" && (
        <div
          aria-hidden="true"
          className="-mt-4 flex h-9 touch-none items-center justify-center"
          onPointerDown={(e) => {
            start.current = { y: e.clientY, time: e.timeStamp };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            start.current = null;
          }}
          onPointerUp={(e) => {
            if (!start.current) return;
            const distance = e.clientY - start.current.y,
              elapsed = Math.max(1, e.timeStamp - start.current.time);
            start.current = null;
            if (distance > 80 || distance / elapsed > 0.5) onClose();
          }}
        >
          <span className="h-1 w-9 rounded-full bg-sunken-strong" />
        </div>
      )}
      {children}
    </ModalSurface>
  );
});
