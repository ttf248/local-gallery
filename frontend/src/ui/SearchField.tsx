import {
  forwardRef,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { SearchIcon, CloseIcon } from "./icons";
import { cx } from "./cx";
export interface SearchFieldProps extends Omit<
  ComponentPropsWithoutRef<"input">,
  "size" | "onChange" | "onSubmit"
> {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit?: (value: string, event: KeyboardEvent<HTMLInputElement>) => void;
  size?: "md" | "lg";
  trailing?: ReactNode;
}
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField(
    {
      value,
      onValueChange,
      onSubmit,
      size = "md",
      trailing,
      className,
      onKeyDown,
      onCompositionStart,
      onCompositionEnd,
      ...props
    },
    ref,
  ) {
    const input = useRef<HTMLInputElement | null>(null),
      composing = useRef(false);
    return (
      <div
        role="search"
        className={cx(
          "flex min-w-0 items-center gap-2 rounded-md bg-sunken px-3 focus-within:bg-canvas focus-within:shadow-focus",
          size === "lg" ? "h-[52px]" : "h-9",
          className,
        )}
      >
        <SearchIcon aria-hidden="true" size={20} />
        <input
          aria-label={props.placeholder || "搜索"}
          {...props}
          type="search"
          value={value}
          className="h-full min-w-0 flex-1 bg-transparent outline-none"
          ref={(el) => {
            input.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) ref.current = el;
          }}
          onCompositionStart={(event) => {
            composing.current = true;
            onCompositionStart?.(event);
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            onCompositionEnd?.(event);
          }}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (
              event.defaultPrevented ||
              composing.current ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            )
              return;
            if (event.key === "Enter" && onSubmit) {
              event.preventDefault();
              onSubmit(value, event);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (value) onValueChange("");
              else event.currentTarget.blur();
            }
          }}
        />
        {value && (
          <button
            type="button"
            aria-label="清除搜索"
            className="grid size-8 place-items-center rounded-md text-ink-2 hover:bg-hover touch:size-10"
            onClick={() => {
              onValueChange("");
              input.current?.focus();
            }}
          >
            <CloseIcon size={16} />
          </button>
        )}
        {trailing}
      </div>
    );
  },
);
