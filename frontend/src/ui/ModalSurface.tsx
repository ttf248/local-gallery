import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "./useFocusTrap";

const layers: HTMLDialogElement[] = [];
const previousInert = new Map<HTMLElement, boolean>();
let overflow = "";
function syncBackground() {
  for (const [element, value] of previousInert)
    element.toggleAttribute("inert", value);
  previousInert.clear();
  const top = layers.at(-1);
  if (!top) return;
  for (const node of document.body.children) {
    if (!(node instanceof HTMLElement) || node === top) continue;
    previousInert.set(node, node.hasAttribute("inert"));
    node.setAttribute("inert", "");
  }
}
export interface ModalProps extends Omit<
  ComponentPropsWithoutRef<"dialog">,
  "open" | "onClose"
> {
  open: boolean;
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement>;
}
export const ModalSurface = forwardRef<HTMLDialogElement, ModalProps>(
  function ModalSurface(
    { open, onClose, initialFocus, children, onKeyDown, onClick, ...props },
    ref,
  ) {
    const local = useRef<HTMLDialogElement | null>(null);
    useFocusTrap(local, open);
    useLayoutEffect(() => {
      const dialog = local.current;
      if (!open || !dialog) return;
      const before = document.activeElement;
      if (!layers.length) {
        overflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      }
      layers.push(dialog);
      syncBackground();
      dialog.showModal();
      const first = dialog.querySelector<HTMLElement>(
        "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex='0']",
      );
      (initialFocus?.current ?? first ?? dialog).focus({ preventScroll: true });
      return () => {
        const index = layers.indexOf(dialog),
          wasTop = index === layers.length - 1;
        layers.splice(index, 1);
        dialog.close();
        syncBackground();
        if (!layers.length) document.body.style.overflow = overflow;
        if (
          wasTop &&
          before instanceof HTMLElement &&
          before.isConnected &&
          !before.closest("[inert]")
        )
          before.focus({ preventScroll: true });
      };
    }, [open, initialFocus]);
    if (!open) return null;
    return createPortal(
      <dialog
        {...props}
        ref={(el) => {
          local.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        tabIndex={-1}
        aria-modal="true"
        onCancel={(event) => {
          event.preventDefault();
          if (layers.at(-1) === local.current) onClose();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          onKeyDown?.(event);
          if (
            !event.defaultPrevented &&
            event.key === "Escape" &&
            !event.nativeEvent.isComposing &&
            layers.at(-1) === local.current
          ) {
            event.stopPropagation();
            event.preventDefault();
            onClose();
          }
        }}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || event.target !== event.currentTarget)
            return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }}
      >
        {children}
      </dialog>,
      document.body,
    );
  },
);
