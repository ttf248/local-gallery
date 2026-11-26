import { forwardRef, useId, type ReactNode } from "react";
import { ModalSurface, type ModalProps } from "./ModalSurface";
import { cx } from "./cx";
import { IconButton } from "./IconButton";
import { CloseIcon } from "./icons";
interface Props extends ModalProps {
  title: string;
  description?: string;
  size?: "sm" | "md" | "lg";
  footer?: ReactNode;
}
export const Dialog = forwardRef<HTMLDialogElement, Props>(function Dialog(
  {
    title,
    description,
    size = "md",
    footer,
    children,
    onClose,
    className,
    ...props
  },
  ref,
) {
  const id = useId();
  return (
    <ModalSurface
      {...props}
      ref={ref}
      onClose={onClose}
      aria-labelledby={id}
      aria-describedby={description ? id + "-description" : undefined}
      className={cx(
        "modal-surface dialog-surface m-auto max-h-[90dvh] max-w-[calc(100vw-32px)] rounded-sheet p-6",
        { sm: "w-[400px]", md: "w-[560px]", lg: "w-[760px]" }[size],
        className,
      )}
    >
      <header className="mb-4 flex items-center justify-between gap-4">
        <h2 id={id} className="text-title-3">
          {title}
        </h2>
        <IconButton label="关闭" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </header>
      {description && (
        <p className="mb-4 text-fg-muted" id={id + "-description"}>
          {description}
        </p>
      )}
      {children}
      {footer && (
        <footer className="mt-6 flex justify-end gap-2">{footer}</footer>
      )}
    </ModalSurface>
  );
});
