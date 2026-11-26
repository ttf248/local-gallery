import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type ForwardedRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

export interface SegmentedOption<T extends string> {
  /** 按钮内容：文字，或图形（图形要另给 ariaLabel 当可访问名）。 */
  label: ReactNode;
  value: T;
  /** 图形按钮的可访问名。 */
  ariaLabel?: string;
  disabled?: boolean;
  title?: string;
}

interface Props<T extends string> extends Omit<
  ComponentPropsWithoutRef<"div">,
  "onChange"
> {
  size?: "sm" | "md";
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
  /**
   * 把标签摆在控件左边。
   *
   * 同一行里有两组分段控件时（「结果类别」与「处理状态」），光看按钮
   * 分不出哪一组管什么 —— 两组里都有「全部」。标签露出来，两组各管
   * 一件事才读得出来。
   */
  showLabel?: boolean;
}

/**
 * 分段控件：在一组互斥的选项里选一个。
 *
 * 同一类操作都用它 —— 展开/折叠、照片/漫画、增量/全量、照片墙密度 ——
 * 长得一样，用户看一眼就知道这是「二选一」。用 radio 语义并支持左右
 * 方向键，键盘用户不必逐个 Tab 过去。
 */
function SegmentedControl<T extends string>(
  {
    options,
    value,
    onChange,
    label,
    disabled = false,
    compact = false,
    showLabel = false,
    size = "md",
    className,
    ...props
  }: Props<T>,
  forwardedRef: ForwardedRef<HTMLDivElement>,
) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const group = ref.current;
    if (!group) return;
    const position = () => {
      const selected = group.querySelector<HTMLElement>(
        '[aria-checked="true"]',
      );
      group.style.setProperty(
        "--segment-left",
        (selected?.offsetLeft ?? 0) + "px",
      );
      group.style.setProperty(
        "--segment-width",
        (selected?.offsetWidth ?? 0) + "px",
      );
    };
    position();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(position);
    observer?.observe(group);
    for (const child of group.children) observer?.observe(child);
    return () => observer?.disconnect();
  }, [value, options]);
  function move(step: number) {
    const enabled = options.filter((option) => !option.disabled);
    if (enabled.length === 0) return;
    const currentIndex = enabled.findIndex((option) => option.value === value);
    const nextIndex = (currentIndex + step + enabled.length) % enabled.length;
    onChange(enabled[nextIndex].value);
    const buttons = ref.current?.querySelectorAll<HTMLButtonElement>(
      'button[role="radio"]:not(:disabled)',
    );
    buttons?.[nextIndex]?.focus();
  }

  return (
    <div
      {...props}
      ref={forwardedRef}
      className={["inline-flex items-center gap-2", className]
        .filter(Boolean)
        .join(" ")}
    >
      {showLabel ? (
        <span className="shrink-0 text-caption text-fg-muted">{label}</span>
      ) : null}
      <div
        ref={ref}
        role="radiogroup"
        aria-label={label}
        className="segments"
        data-size={size}
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
              className={compact ? "min-w-8" : undefined}
              tabIndex={
                selected ||
                (!options.some(
                  (item) => item.value === value && !item.disabled,
                ) &&
                  options.find((item) => !item.disabled)?.value ===
                    option.value)
                  ? 0
                  : -1
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const Segmented = forwardRef(SegmentedControl) as <T extends string>(
  props: Props<T> & { ref?: ForwardedRef<HTMLDivElement> },
) => JSX.Element;
export default Segmented;
