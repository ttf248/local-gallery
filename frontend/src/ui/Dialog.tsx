import { forwardRef, useId, type ReactNode } from "react";
import { ModalSurface, type ModalProps } from "./ModalSurface";
import { cx } from "./cx";
import { IconButton } from "./IconButton";
import { CloseIcon } from "./icons";
interface Props extends ModalProps {
  title: string;
  tone?: "theme" | "reader";
  description?: string;
  size?: "sm" | "md" | "lg";
  footer?: ReactNode;
}
export const Dialog = forwardRef<HTMLDialogElement, Props>(function Dialog(
  {
    title,
    tone = "theme",
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
      data-tone={tone === "reader" ? "reader" : undefined}
      onClose={onClose}
      aria-labelledby={id}
      aria-describedby={description ? id + "-description" : undefined}
      className={cx(
        tone === "reader"
          ? "bg-theater-surface text-theater-fg"
          : "bg-raised text-ink",
        "overflow-auto shadow-3 open:motion-safe:animate-[dialog-in_180ms_var(--ease-spring)] open:motion-reduce:animate-[fadeIn_120ms_linear] m-auto max-h-[90dvh] max-w-[calc(100vw-32px)] rounded-xl p-6",
        { sm: "w-[400px]", md: "w-[560px]", lg: "w-[720px]" }[size],
        className,
      )}
    >
      <header className="mb-4 flex items-center justify-between gap-4">
        <h2 id={id} className="text-heading">
          {title}
        </h2>
        <IconButton label="关闭" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </header>
      {description && (
        <p className="mb-4 text-ink-2" id={id + "-description"}>
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
