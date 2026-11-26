import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { FilterIcon } from "../../ui/icons";

interface DropdownProps {
  label: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panel: ReactNode;
  dialogLabel?: string;
}

/**
 * 一个轻量的下拉：点按钮开面板，点外面或按 Esc 关上。
 *
 * 不用通用的 Popover：那一族是菜单（role=menu、方向键在菜单项间跳），
 * 筛选面板是一块内容，语义与键盘行为都不一样。
 *
 * 面板挂在视口上，不挂在按钮上：按钮在窄屏上贴着内容区的右边，
 * 面板右对齐到按钮就会有一半掉出屏幕。位置量出来再夹到视口里。
 */
export function FilterDropdown({
  label,
  count,
  open,
  onOpenChange,
  panel,
  dialogLabel = "筛选照片",
}: DropdownProps) {
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.focus({ preventScroll: true });
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onOpenChange, open]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = menu?.offsetWidth ?? 320;
      const height = menu?.offsetHeight ?? 420;
      const margin = 8;
      let left = rect.right - width;
      if (left < margin) left = margin;
      if (left + width > window.innerWidth - margin) {
        left = window.innerWidth - margin - width;
      }
      let top = rect.bottom + 6;
      if (top + height > window.innerHeight - margin) {
        const above = rect.top - 6 - height;
        top =
          above >= margin
            ? above
            : Math.max(margin, window.innerHeight - margin - height);
      }
      setPosition((previous) =>
        previous &&
        Math.abs(previous.top - top) < 0.5 &&
        Math.abs(previous.left - left) < 0.5
          ? previous
          : { top, left },
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`btn btn-ghost inline-flex items-center gap-1.5 text-caption focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          count > 0
            ? "bg-primary/12 text-primary"
            : "text-ink-2 hover:bg-sunken hover:text-ink"
        }`}
      >
        <FilterIcon size={13} />
        {label}
        {count > 0 && (
          <span className="rounded-full bg-primary/20 px-1.5 text-caption tabular-nums text-primary">
            {count}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label={dialogLabel}
            tabIndex={-1}
            style={{
              position: "fixed",
              /* 位置量出来之前先挂在屏外：面板始终在 DOM 里，
               量得到真实尺寸；布局阶段再把它挪到该在的地方。 */
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              zIndex: 35,
            }}
            className="ui-popover w-[360px] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] overflow-y-auto p-3"
          >
            {panel}
          </div>,
          document.body,
        )}
    </div>
  );
}
