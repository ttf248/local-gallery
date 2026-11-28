import type { ReactNode } from "react";
import { usePageChrome, type PageChromeConfig } from "./PageChrome";
export interface PageHeroProps {
  title: string;
  compact?:boolean;
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
export function PageHero({
  title,compact,
  titleContent,
  titleEditor,
  leading,
  eyebrow,
  meta,
  actions,
  toolbar,
  chips,
  chrome,
}: PageHeroProps) {
  const { titleRef } = usePageChrome({ title, ...chrome });
  return (
    <header data-page-header className={compact ? "min-w-0 pb-2 pt-3" : "min-w-0 pb-3 pt-5 lg:pb-5 lg:pt-8"}>
      {eyebrow && (
        <div className="mb-2 text-caption text-ink-3">{eyebrow}</div>
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
                  : compact ? "break-words text-title" : "break-words text-display"
              }
            >
              {titleEditor ? title : (titleContent ?? title)}
            </h1>
            {titleEditor}
            {meta && (
              <div className="mt-1 text-caption tabular-nums text-ink-2">
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
