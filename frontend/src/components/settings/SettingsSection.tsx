import type { ReactNode } from "react";

export function Section({
  id,
  title,
  icon,
  description,
  children,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="settings-section ui-surface"
    >
      <div className="settings-section__head">
        {icon ? (
          <span className="settings-section__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <div className="settings-section__headings">
          <h2 id={headingId} className="settings-section__title">
            {title}
          </h2>
          {description ? (
            <p className="settings-section__desc">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

/**
 * 分组里的一行设置：左边一个不换行的标签，右边放控件。
 */
export function Row({
  label,
  children,
  danger,
  className,
}: {
  label: string;
  children: ReactNode;
  danger?: boolean;
  /** 行本身的外类：窄屏才出现的设置用它把自己藏起来。 */
  className?: string;
}) {
  return (
    // 标签固定不换行：内容多的时候应该让内容换行，而不是把标签
    // 挤成两行、同时把右侧内容裁掉。
    <div className={`settings-row text-body ${className ?? ""}`}>
      <span
        className={`whitespace-nowrap ${danger ? "text-danger" : "text-fg"}`}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
