import type { ReactNode } from "react";

/**
 * 设置页的一张卡。
 *
 * 标题放进卡片而不是浮在卡片外面：外面还要另起一段留白与分隔线，
 * 一页七段就多出七段空白。放进顶栏后，标题与内容是同一块板的上下两半，
 * 整页只剩「一块设置」这一种样子。
 *
 * section 带 id 与 aria-labelledby：无障碍里它是一个名为分区名的 region。
 */
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
    <section id={id} aria-labelledby={headingId} className="settings-card">
      <div className="settings-card__head">
        {icon && <span className="settings-card__icon">{icon}</span>}
        <h2 id={headingId} className="settings-card__title">
          {title}
        </h2>
        {description ? (
          <span className="settings-card__desc">{description}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * 卡里的一行设置：左边一个不换行的标签，右边放控件。
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
    <div
      className={`settings-row flex items-center justify-between gap-3 px-4 py-2.5 text-body ${className ?? ""}`}
    >
      <span
        className={`shrink-0 whitespace-nowrap ${danger ? "text-danger" : "text-fg"}`}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
