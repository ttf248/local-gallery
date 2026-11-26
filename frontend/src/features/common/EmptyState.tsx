import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  /**
   * 紧凑模式：下方还有内容（推荐位、说明列表）时用。
   * 默认高度是给"整页只有这一块"准备的；下面还接着内容时不再撑高，
   * 否则会把下面的东西推到首屏之外。
   */
  dense?: boolean;
  /**
   * 行内模式：一行文字，放在卡片里。
   *
   * 「还没有任务」这种状态不值得占一屏 —— 之前三个空状态各占两百多像素，
   * 页面一半的篇幅是空的。行内模式让空态退回它该有的分量：一句话。
   */
  inline?: boolean;
}

// 居中空态：图标 + 标题 + 描述 + 可选操作。
export default function EmptyState({
  title,
  description,
  action,
  icon,
  dense = false,
  inline = false,
}: Props) {
  if (inline) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-4 text-caption text-fg-subtle sm:px-6">
        {icon ? <span className="shrink-0 text-fg-muted">{icon}</span> : null}
        <span className="text-fg-muted">{title}</span>
        {description ? <span>{description}</span> : null}
      </div>
    );
  }
  return (
    <div
      className={`page-shell empty-state flex flex-col items-center justify-center py-12 text-center fade-up [animation:fadeUp_320ms_var(--ease-emphasized)_both] ${
        dense ? "pb-8" : "min-h-[30vh]"
      }`}
    >
      {icon && (
        <div className="empty-state__icon relative isolate w-14 h-[60px] text-accent [transform:rotate(-5deg)] before:content-[''] before:absolute before:inset-0 before:z-[-1] before:rounded-[14px_14px_14px_3px] before:bg-bg-strong before:[transform:translate(8px,8px)] after:content-[''] after:absolute after:inset-0 after:z-0 after:rounded-[14px_14px_14px_3px] after:border after:border-line after:bg-accent-soft [&>*]:relative [&>*]:z-[1] flex items-center justify-center mb-4">
          {icon}
        </div>
      )}
      <h2 className="font-display text-title-3 font-semibold text-fg">
        {title}
      </h2>
      {description && (
        <div className="text-body text-fg-muted mt-2 max-w-md leading-relaxed">
          {description}
        </div>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
