import type { ReactNode } from "react";

export function ReviewLayout({
  list,
  stage,
  listWidth = 360,
}: {
  list: ReactNode;
  stage: ReactNode;
  listWidth?: 320 | 360;
}) {
  return (
    <div
      data-review-layout
      className={`grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border border-line-subtle ${listWidth === 320 ? "xl:grid-cols-[320px_minmax(0,1fr)]" : "xl:grid-cols-[360px_minmax(0,1fr)]"}`}
    >
      <div className="min-h-0 min-w-0 overflow-auto border-line-subtle xl:border-r">
        {list}
      </div>
      <div className="min-h-0 min-w-0 overflow-auto">{stage}</div>
    </div>
  );
}
