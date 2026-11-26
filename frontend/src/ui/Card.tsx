import { forwardRef } from "react";
import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";
export interface CardProps {
  className?: string;
  to?: string;
  onOpen?: () => void;
  media: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  overlay?: ReactNode;
  stacked?: boolean;
  aspect?: "4/3" | "2/3" | "1/1" | "3/2";
  selected?: boolean;
  selecting?: boolean;
  onSelect?: (range: boolean) => void;
}
const aspectClass = {
  "4/3": "aspect-[4/3]",
  "2/3": "aspect-[2/3]",
  "1/1": "aspect-square",
  "3/2": "aspect-[3/2]",
};
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    className,
    to,
    onOpen,
    media,
    title,
    meta,
    overlay,
    stacked,
    aspect = "4/3",
    selected,
    selecting,
    onSelect,
  },
  forwardedRef,
) {
  const label = useId();
  const control =
    "absolute inset-0 z-10 rounded-lg focus-visible:ring-2 focus-visible:ring-accent";
  return (
    <article
      ref={forwardedRef}
      className={cx("group relative isolate min-w-0", className)}
    >
      <div className="relative">
        {stacked && (
          <div
            aria-hidden="true"
            data-stacked=""
            className="absolute -top-1 inset-x-1 bottom-0 -z-10 rounded-lg bg-sunken-strong before:absolute before:-top-1 before:inset-x-1 before:bottom-1 before:-z-10 before:rounded-lg before:bg-media"
          />
        )}
        <div
          className={cx(
            "overflow-hidden rounded-lg bg-media transition-shadow group-hover:shadow-2 motion-safe:[&_img]:transition-transform motion-safe:group-hover:[&_img]:scale-[1.03]",
            aspectClass[aspect],
          )}
        >
          {media}
        </div>
        {overlay && !selecting && (
          <div className="absolute right-2 top-2 z-20">{overlay}</div>
        )}
      </div>
      <div
        id={label}
        className="mt-2 truncate text-subheading"
        title={typeof title === "string" ? title : undefined}
      >
        {title}
      </div>
      {meta && <div className="truncate text-caption text-ink-2">{meta}</div>}
      {selecting ? (
        <button
          type="button"
          role="option"
          aria-selected={Boolean(selected)}
          aria-labelledby={label}
          className={cx(control, selected && "ring-2 ring-accent")}
          onClick={(event) => onSelect?.(event.shiftKey)}
        />
      ) : to ? (
        <Link to={to} aria-labelledby={label} className={control} />
      ) : (
        <button
          type="button"
          aria-labelledby={label}
          className={control}
          onClick={onOpen}
        />
      )}
    </article>
  );
});
