import { useRef, type ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  /** 按钮内容：文字，或图形（图形要另给 ariaLabel 当可访问名）。 */
  label: ReactNode;
  value: T;
  /** 图形按钮的可访问名。 */
  ariaLabel?: string;
  disabled?: boolean;
  title?: string;
}

interface Props<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 无障碍名称：这个分段控件管的是什么。 */
  label: string;
  disabled?: boolean;
  /**
   * 紧凑档：按钮只放一枚小图形（密度切换用）。
   *
   * 图形档比文字档矮一档、窄一档：它出现在工具条里，四个按钮排在一起
   * 不能把旁边的操作挤走。选中态也比文字档更「抬起来」—— 图形之间的
   * 差别靠明暗读，不靠底色深一档（浅色画布上几乎看不出差别）。
   */
  compact?: boolean;
}

/**
 * 分段控件：在一组互斥的选项里选一个。
 *
 * 同一类操作都用它 —— 展开/折叠、照片/漫画、增量/全量、照片墙密度 ——
 * 长得一样，用户看一眼就知道这是「二选一」。用 radio 语义并支持左右
 * 方向键，键盘用户不必逐个 Tab 过去。
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
  compact = false,
}: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);

  function move(step: number) {
    const enabled = options.filter((option) => !option.disabled);
    if (enabled.length === 0) return;
    const currentIndex = enabled.findIndex((option) => option.value === value);
    const nextIndex =
      (currentIndex + step + enabled.length) % enabled.length;
    onChange(enabled[nextIndex].value);
    const buttons = ref.current?.querySelectorAll<HTMLButtonElement>(
      'button[role="radio"]',
    );
    buttons?.[nextIndex]?.focus();
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center overflow-hidden rounded-md border border-border bg-bg-subtle/40"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.ariaLabel}
            disabled={disabled || option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(1);
              } else if (
                event.key === "ArrowLeft" ||
                event.key === "ArrowUp"
              ) {
                event.preventDefault();
                move(-1);
              }
            }}
            className={
              compact
                ? `inline-flex h-7 w-8 items-center justify-center transition-colors ${
                    selected
                      ? "bg-bg-elevated text-fg shadow-xs"
                      : "text-fg-muted hover:text-fg"
                  } disabled:opacity-50`
                : `h-8 px-3 text-meta transition-colors ${
                    selected
                      ? "bg-bg-strong text-fg"
                      : "text-fg-muted hover:bg-bg-subtle"
                  } disabled:opacity-50`
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
