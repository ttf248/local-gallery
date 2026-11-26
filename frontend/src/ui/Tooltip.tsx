import {
  cloneElement,
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { floatingPosition, type Side } from "./floatingPosition";
import { cx } from "./cx";
interface Props extends Omit<
  ComponentPropsWithoutRef<"span">,
  "children" | "content"
> {
  content: string;
  side?: Side;
  delay?: number;
  children: ReactElement;
}
export const Tooltip = forwardRef<HTMLSpanElement, Props>(function Tooltip(
  { content, side = "top", delay = 500, children, className, ...props },
  ref,
) {
  const id = useId(),
    tip = useRef<HTMLSpanElement>(null),
    timer = useRef<ReturnType<typeof setTimeout>>();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null),
    [pos, setPos] = useState({ left: 0, top: 0 });
  function hide() {
    clearTimeout(timer.current);
    setAnchor(null);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!anchor || !tip.current) return;
    const layer = tip.current;
    function update() {
      if (anchor)
        setPos(
          floatingPosition(
            anchor.getBoundingClientRect(),
            layer.offsetWidth,
            layer.offsetHeight,
            side,
          ),
        );
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") hide();
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [anchor, side, content]);
  return (
    <span
      {...props}
      ref={ref}
      className={cx("inline-flex", className)}
      onPointerEnter={(event) => {
        if (
          event.pointerType === "touch" ||
          (window.matchMedia && !window.matchMedia("(hover: hover)").matches)
        )
          return;
        const target = event.currentTarget;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setAnchor(target), delay);
      }}
      onPointerLeave={hide}
      onFocus={(event) => {
        if (event.target.matches(":focus-visible"))
          setAnchor(event.currentTarget);
      }}
      onBlur={hide}
    >
      {cloneElement(children, {
        "aria-describedby":
          [children.props["aria-describedby"], anchor && id]
            .filter(Boolean)
            .join(" ") || undefined,
      })}
      {anchor &&
        createPortal(
          <span
            role="tooltip"
            id={id}
            ref={tip}
            style={pos}
            className="pointer-events-none fixed z-popover max-w-[calc(100vw-8px)] rounded-sm bg-inverse-bg px-2 py-1.5 text-micro text-inverse-fg"
          >
            {content}
          </span>,
          anchor.closest("dialog[open]") ?? document.body,
        )}
    </span>
  );
});
