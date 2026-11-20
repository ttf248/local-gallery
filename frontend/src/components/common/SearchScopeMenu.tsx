import { useEffect, useRef, useState } from "react";
import {
  SEARCH_SCOPE_OPTIONS,
  searchScopeOption,
  type SearchScope,
} from "../../utils/searchScope";
import { ChevronDownIcon } from "./Icon";

interface Props {
  value: SearchScope;
  onChange: (scope: SearchScope) => void;
  /** 这一侧支持哪些作用域（漫画侧只有名字）。 */
  options?: typeof SEARCH_SCOPE_OPTIONS;
  className?: string;
}

/**
 * 搜索框里的作用域选择。
 *
 * 它是一枚按钮而不是一段文字：按钮点开是一份两选一的清单，每一项都写
 * 清「这一类搜的是什么」。用户按下回车之前就知道自己搜的是容器的名字
 * 还是照片里的画面 —— 搜不到时不至于以为库里没有那张照片。
 *
 * 窄屏上顶栏放不下 segmented，这里因此用菜单：按钮上只留两个字的短词，
 * 展开时才摊开完整说明。
 */
export default function SearchScopeMenu({
  value,
  onChange,
  options = SEARCH_SCOPE_OPTIONS,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = searchScopeOption(value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  return (
    <div ref={wrapRef} className={`relative shrink-0 ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`搜索范围：${current.hint}`}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 items-center gap-1 rounded-full px-2 text-meta font-medium text-fg-muted transition-colors hover:bg-bg-strong hover:text-fg"
      >
        <span>{current.label}</span>
        <ChevronDownIcon size={11} className="shrink-0" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="搜索范围"
          className="absolute left-0 top-full z-40 mt-1.5 w-64 rounded-lg border border-border bg-bg-elevated py-1 shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => {
                setOpen(false);
                onChange(option.value);
                buttonRef.current?.focus();
              }}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
                option.value === value
                  ? "bg-bg-subtle"
                  : "hover:bg-bg-subtle"
              }`}
            >
              <span className="text-body text-fg">{option.label}</span>
              <span className="text-meta text-fg-muted">{option.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
