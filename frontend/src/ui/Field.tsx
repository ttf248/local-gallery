import { useRef } from "react";
import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cx } from "./cx";
import { CloseIcon, SearchIcon } from "./icons";

interface TextProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
  hint?: string;
  error?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}
export const TextField = forwardRef<HTMLInputElement, TextProps>(
  function TextField(
    { label, hint, error, id, leading, trailing, className, ...props },
    ref,
  ) {
    const generated = useId();
    const inputId = id ?? generated;
    return (
      <div className={cx("grid gap-1.5", className)}>
        <label htmlFor={inputId} className="text-callout">
          {label}
        </label>
        <div className="field-frame h-10 rounded-control">
          {leading}
          <input
            {...props}
            ref={ref}
            id={inputId}
            aria-invalid={Boolean(error)}
            aria-describedby={
              error || hint ? inputId + "-hint" : props["aria-describedby"]
            }
          />
          {trailing}
        </div>
        {(error || hint) && (
          <p
            className={
              error ? "text-caption text-danger" : "text-caption text-fg-muted"
            }
            id={inputId + "-hint"}
          >
            {error || hint}
          </p>
        )}
      </div>
    );
  },
);
interface SearchProps extends Omit<
  ComponentPropsWithoutRef<"input">,
  "size" | "value" | "onChange" | "onSubmit"
> {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onClear?: () => void;
  scope?: ReactNode;
  size?: "md" | "lg";
}
export const SearchField = forwardRef<HTMLInputElement, SearchProps>(
  function SearchField(
    {
      value,
      onChange,
      onSubmit,
      onClear = () => onChange(""),
      placeholder,
      scope,
      size = "md",
      className,
      onKeyDown,
      ...props
    },
    ref,
  ) {
    const input = useRef<HTMLInputElement | null>(null);
    return (
      <div
        role="search"
        className={cx(
          "field-frame",
          size === "lg" ? "h-14 rounded-card" : "h-10 rounded-control",
          className,
        )}
      >
        <SearchIcon aria-hidden="true" />
        <input
          type="search"
          aria-label={placeholder || "搜索"}
          {...props}
          placeholder={placeholder}
          value={value}
          ref={(el) => {
            input.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) ref.current = el;
          }}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (
              event.defaultPrevented ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            )
              return;
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit(value);
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              event.preventDefault();
              if (value) onClear();
              else event.currentTarget.blur();
            }
          }}
        />
        {scope}
        {value && (
          <>
            <button
              className="grid size-10 place-items-center"
              type="button"
              aria-label="清除搜索"
              title="清除搜索"
              onClick={() => {
                onClear();
                input.current?.focus();
              }}
            >
              <CloseIcon />
            </button>
            <button
              type="button"
              className="size-10"
              aria-label="提交搜索"
              title="提交搜索"
              onClick={() => onSubmit(value)}
            >
              ↵
            </button>
          </>
        )}
      </div>
    );
  },
);
