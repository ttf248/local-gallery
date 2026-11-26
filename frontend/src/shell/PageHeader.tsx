import type { ReactNode } from "react";
import { usePageChrome, type PageChromeConfig } from "./PageChrome";
export interface PageHeaderProps {
  title: string;
  titleContent?: ReactNode;
  titleEditor?: ReactNode;
  leading?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  chips?: ReactNode;
  chrome?: Omit<PageChromeConfig, "title">;
}
export function PageHeader({
  title,
  titleContent,
  titleEditor,
  leading,
  eyebrow,
  meta,
  actions,
  toolbar,
  chips,
  chrome,
}: PageHeaderProps) {
  const { titleRef } = usePageChrome({ title, ...chrome });
  return (
    <header className="min-w-0 pb-6 pt-[clamp(24px,3vw,48px)]">
      {eyebrow && (
        <div className="mb-2 text-caption text-fg-muted">{eyebrow}</div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {leading}
          <div className="min-w-0">
            <h1
              ref={titleRef}
              className={
                titleEditor
                  ? "sr-only"
                  : "break-words font-display text-title-1"
              }
            >
              {titleEditor ? title : (titleContent ?? title)}
            </h1>
            {titleEditor}
            {meta && (
              <div className="mt-1.5 text-caption tabular-nums text-fg-muted">
                {meta}
              </div>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {toolbar && (
        <div className="mt-4 flex flex-wrap items-center gap-3">{toolbar}</div>
      )}
      {chips && <div className="mt-3 flex flex-wrap gap-2">{chips}</div>}
    </header>
  );
}
