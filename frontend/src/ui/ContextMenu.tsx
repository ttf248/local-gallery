import {
  forwardRef,
  useMemo,
  useRef,
  type ComponentPropsWithoutRef,
} from "react";
import { MenuSurface, type MenuItem } from "./Menu";
interface Props extends ComponentPropsWithoutRef<"div"> {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  label?: string;
}
export const ContextMenu = forwardRef<HTMLDivElement, Props>(
  function ContextMenu({ x, y, label = "上下文菜单", ...props }, ref) {
    const anchor = useMemo(() => ({ x, y }), [x, y]);
    const trigger = useRef(
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
    );
    return (
      <MenuSurface
        {...props}
        ref={ref}
        label={label}
        anchor={anchor}
        restoreFocus={trigger.current}
      />
    );
  },
);
