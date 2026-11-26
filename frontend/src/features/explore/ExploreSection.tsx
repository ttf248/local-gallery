import { useId, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRightLineIcon, InfoIcon } from "../../ui/icons";
import { floatingPosition } from "../../ui/floatingPosition";
import { Skeleton } from "../../ui/Skeleton";

export function ExploreSection({
  id,
  title,
  to,
  linkLabel,
  info,
  children,
}: {
  id: string;
  title: string;
  to: string;
  linkLabel: string;
  info?: string;
  children: ReactNode;
}) {
  const noteId = useId();
  const note = useRef<HTMLDivElement | null>(null);
  return (
    <section className="min-w-0 pt-[var(--section-gap)]" aria-labelledby={id}>
      <div className="mb-4 flex items-center gap-2">
        <h2 id={id} className="text-title-2">
          {title}
        </h2>
        {info && (
          <>
            <button
              type="button"
              className="grid size-9 place-items-center text-fg-muted"
              aria-label={title + "说明"}
              aria-controls={noteId}
              onClick={(event) => {
                const panel = note.current;
                if (!panel || !panel.togglePopover()) return;
                const pos = floatingPosition(
                  event.currentTarget.getBoundingClientRect(),
                  panel.offsetWidth,
                  panel.offsetHeight,
                  "bottom",
                );
                Object.assign(panel.style, {
                  left: pos.left + "px",
                  top: pos.top + "px",
                });
              }}
            >
              <InfoIcon size={16} />
            </button>
            <div
              id={noteId}
              ref={(node) => {
                note.current = node;
                node?.setAttribute("popover", "auto");
              }}
              className="fixed inset-auto m-0 max-w-[min(360px,90vw)] rounded-card bg-bg-elevated p-4 text-callout text-fg shadow-2"
            >
              {info}
            </div>
          </>
        )}
        <Link
          to={to}
          className="ml-auto inline-flex min-h-10 items-center gap-1 text-callout text-fg-muted hover:text-fg"
        >
          {linkLabel}
          <ArrowRightLineIcon size={16} />
        </Link>
      </div>
      {children}
    </section>
  );
}
export function PreviewSkeleton({
  label,
  shape,
}: {
  label: string;
  shape: "person" | "place" | "year" | "theme";
}) {
  const size = {
    person: "size-[120px]",
    place: "aspect-[3/2] w-[300px]",
    year: "h-[72px] w-28",
    theme: "aspect-[4/3] w-64",
  }[shape];
  return (
    <div role="status" className="flex gap-4 overflow-hidden">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton
          key={i}
          shape={shape === "person" ? "circle" : "rect"}
          className={size + " shrink-0"}
        />
      ))}
    </div>
  );
}
