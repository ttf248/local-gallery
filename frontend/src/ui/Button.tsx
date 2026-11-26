import { cx } from "./cx";
import {
  cloneElement,
  forwardRef,
  type ReactElement,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import {buttonStyles as styles} from "./buttonStyles";
import { Spinner } from "./Spinner";
interface StyleProps {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}
type AnchorProps = ComponentPropsWithoutRef<"a">;
export type ButtonProps = StyleProps &
  (
    | (ComponentPropsWithoutRef<"button"> & { asChild?: false })
    | (AnchorProps & { asChild: true; children: ReactElement<AnchorProps> })
  );

export const Button = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ButtonProps
>(function Button(props, ref) {
  const {
    variant,
    size,
    loading,
    disabled,
    leadingIcon,
    trailingIcon,
    className,
    children,
    asChild,
    ...rest
  } = props;
  const locked = Boolean(loading || disabled);
  function content(children: ReactNode) {
    return (
      <>
        <span
          className={cx(
            "inline-flex items-center gap-2",
            loading && "invisible",
          )}
        >
          {leadingIcon}
          {children}
          {trailingIcon}
        </span>
        {loading && <Spinner className="absolute" />}
      </>
    );
  }
  if (asChild) {
    const link = children;
    const { onClick, ...attrs } = rest as AnchorProps;
    const linkRef = (
      link as ReactElement & { ref?: React.Ref<HTMLAnchorElement> }
    ).ref;
    return cloneElement(
      link as ReactElement<
        AnchorProps & React.RefAttributes<HTMLAnchorElement>
      >,
      {
        ...attrs,
        ref: (node) => {
          for (const target of [ref, linkRef]) {
            if (typeof target === "function") target(node);
            else if (target)
              (
                target as React.MutableRefObject<HTMLAnchorElement | null>
              ).current = node;
          }
        },
        className: styles({
          variant,
          size,
          className: cx(link.props.className, className),
        }),
        "aria-disabled": locked || undefined,
        "aria-busy": loading || undefined,
        tabIndex: locked ? -1 : (attrs.tabIndex ?? link.props.tabIndex),
        onClick: (event) => {
          if (locked) {
            event.preventDefault();
            return;
          }
          link.props.onClick?.(event);
          if (!event.defaultPrevented) onClick?.(event);
        },
      },
      content(link.props.children),
    );
  }
  const attrs = rest as ComponentPropsWithoutRef<"button">;
  return (
    <button
      type="button"
      {...attrs}
      ref={ref as React.Ref<HTMLButtonElement>}
      disabled={locked}
      aria-busy={loading || undefined}
      className={styles({ variant, size, className })}
    >
      {content(children)}
    </button>
  );
});
