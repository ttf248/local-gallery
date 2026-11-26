import {
  cloneElement,
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { handleMenuKeyDown, ENABLED_MENU_ITEM_SELECTOR } from "./menuKeyboard";
import { cx } from "./cx";
import { floatingPosition } from "./floatingPosition";
import { Kbd } from "./Kbd";
import { CheckIcon } from "./icons";
export type MenuItem =
  | {
      id: string;
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      onSelect: () => void;
    }
  | { type: "separator" }
  | { type: "label"; label: string };
interface SurfaceProps extends ComponentPropsWithoutRef<"div"> {
  items: MenuItem[];
  label: string;
  anchor: HTMLElement | { x: number; y: number };
  align?: "start" | "end";
  onClose: () => void;
  restoreFocus?: HTMLElement | null;
}
export const MenuSurface = forwardRef<HTMLDivElement, SurfaceProps>(
  function MenuSurface(
    {
      items,
      label,
      anchor,
      align = "start",
      onClose,
      restoreFocus,
      className,
      style,
      ...props
    },
    ref,
  ) {
    const surface = useRef<HTMLDivElement | null>(null),
      close = useRef(onClose);
    useLayoutEffect(() => {
      close.current = onClose;
    }, [onClose]);
    useLayoutEffect(() => {
      const layer = surface.current;
      if (!layer) return;
      const before = restoreFocus ?? document.activeElement;
      const position = () => {
        const rect =
          anchor instanceof HTMLElement
            ? anchor.getBoundingClientRect()
            : {
                left: anchor.x,
                right: anchor.x,
                top: anchor.y,
                bottom: anchor.y,
              };
        const point = floatingPosition(
          rect,
          layer.offsetWidth,
          layer.offsetHeight,
          "bottom",
          align,
          anchor instanceof HTMLElement ? 4 : 0,
        );
        layer.style.left = point.left + "px";
        layer.style.top = point.top + "px";
      };
      position();
      (
        layer.querySelector<HTMLElement>(ENABLED_MENU_ITEM_SELECTOR) ?? layer
      ).focus();
      function outside(event: PointerEvent) {
        if (
          !layer?.contains(event.target as Node) &&
          !(
            anchor instanceof HTMLElement &&
            anchor.contains(event.target as Node)
          )
        )
          close.current();
      }
      function scroll(event: Event) {
        if (!layer?.contains(event.target as Node)) close.current();
      }
      const dismiss = () => close.current();
      window.addEventListener("resize", position);
      window.addEventListener("blur", dismiss);
      document.addEventListener("pointerdown", outside);
      document.addEventListener("scroll", scroll, true);
      return () => {
        window.removeEventListener("resize", position);
        window.removeEventListener("blur", dismiss);
        document.removeEventListener("pointerdown", outside);
        document.removeEventListener("scroll", scroll, true);
        if (
          before instanceof HTMLElement &&
          before.isConnected &&
          (document.activeElement === document.body ||
            layer.contains(document.activeElement))
        )
          before.focus({ preventScroll: true });
      };
    }, [anchor, align, restoreFocus]);
    return createPortal(
      <div
        {...props}
        ref={(node) => {
          surface.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        style={style}
        className={cx(
          "fixed z-popover max-h-[calc(100dvh-8px)] min-w-44 max-w-[calc(100vw-8px)] overflow-auto rounded-xl bg-bg-elevated p-1 shadow-2",
          className,
        )}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            restoreFocus?.focus();
            onClose();
            return;
          }
          handleMenuKeyDown(event, onClose);
        }}
        onBlur={(event) => {
          if (
            event.relatedTarget &&
            !event.currentTarget.contains(event.relatedTarget)
          )
            onClose();
        }}
      >
        {items.map((item, index) =>
          "type" in item ? (
            item.type === "separator" ? (
              <hr key={index} role="separator" className="my-1 border-line" />
            ) : (
              <div key={index} className="px-3 py-1 text-micro text-fg-subtle">
                {item.label}
              </div>
            )
          ) : (
            <button
              key={item.id}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={item.checked}
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={cx(
                "flex min-h-9 w-full items-center gap-2 rounded-sm px-3 text-left text-callout hover:bg-bg-subtle focus:bg-bg-subtle disabled:opacity-40",
                item.danger && "text-danger",
              )}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {item.shortcut && <Kbd keys={[item.shortcut]} />}{" "}
              {item.checked && <CheckIcon />}
            </button>
          ),
        )}
      </div>,
      (anchor instanceof HTMLElement ? anchor : restoreFocus)?.closest(
        "dialog[open]",
      ) ?? document.body,
    );
  },
);
interface Props extends ComponentPropsWithoutRef<"span"> {
  trigger: ReactElement;
  items: MenuItem[];
  align?: "start" | "end";
  label: string;
}
export const Menu = forwardRef<HTMLSpanElement, Props>(function Menu(
  { trigger, items, align, label, ...props },
  ref,
) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <span {...props} ref={ref}>
      {cloneElement(trigger, {
        "aria-haspopup": "menu",
        "aria-expanded": Boolean(anchor),
        onClick: (event: React.MouseEvent<HTMLElement>) => {
          trigger.props.onClick?.(event);
          if (!event.defaultPrevented)
            setAnchor(anchor ? null : event.currentTarget);
        },
      })}
      {anchor && (
        <MenuSurface
          items={items}
          label={label}
          align={align}
          anchor={anchor}
          restoreFocus={anchor}
          onClose={() => setAnchor(null)}
        />
      )}
    </span>
  );
});
