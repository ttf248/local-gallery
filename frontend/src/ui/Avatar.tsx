import { forwardRef } from "react";
import { useState } from "react";
import { UserIcon } from "./icons";
import { cx } from "./cx";
export interface AvatarProps {
  className?: string;
  src?: string;
  alt: string;
  size: 32 | 56 | 88 | 120;
  ring?: "none" | "accent" | "warning";
}
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { className, src, alt, size, ring = "none" },
  forwardedRef,
) {
  const [failed, setFailed] = useState<string>();
  return (
    <span
      ref={forwardedRef}
      style={{ width: size, height: size }}
      className={cx(
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-media",
        ring === "accent" && "ring-2 ring-accent",
        ring === "warning" && "ring-2 ring-warning",
        className,
      )}
    >
      {src && src !== failed ? (
        <img
          src={src}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(src)}
          className="size-full object-cover"
        />
      ) : (
        <span role="img" aria-label={alt}>
          <UserIcon size={size < 56 ? 16 : 24} />
        </span>
      )}
    </span>
  );
});
