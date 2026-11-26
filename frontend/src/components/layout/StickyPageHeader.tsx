import type { ReactNode } from "react";

export interface StickyPageHeaderProps {
  title: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  breadcrumbs?: ReactNode;
  actions?: ReactNode;
  subbar?: ReactNode;
  className?: string;
}

export default function StickyPageHeader({
  title,
  meta,
  leading,
  breadcrumbs,
  actions,
  subbar,
  className = "",
}: StickyPageHeaderProps) {
  return (
    <header className={`sticky-page-header ui-glass-bar ${className}`}>
      <div className="sticky-page-header__row page-shell">
        {leading && (
          <div className="sticky-page-header__leading">{leading}</div>
        )}
        <div className="sticky-page-header__identity">
          {breadcrumbs && (
            <div className="sticky-page-header__breadcrumbs">{breadcrumbs}</div>
          )}
          <h1
            className="sticky-page-header__title"
            title={typeof title === "string" ? title : undefined}
          >
            {title}
          </h1>
          {meta && <div className="sticky-page-header__meta">{meta}</div>}
        </div>
        {actions && (
          <div className="sticky-page-header__actions">{actions}</div>
        )}
      </div>
      {subbar && (
        <div className="sticky-page-header__subbar page-shell">{subbar}</div>
      )}
    </header>
  );
}
