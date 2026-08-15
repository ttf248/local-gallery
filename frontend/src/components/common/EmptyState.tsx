import type { ReactNode } from 'react'

interface Props {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
}

// 居中空态：图标 + 标题 + 描述 + 可选操作。
// 设计：上呼吸感大、字号克制、不画边框。
export default function EmptyState({ title, description, action, icon }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-10 text-center fade-up">
      {icon && (
        <div className="w-14 h-14 rounded-2xl bg-bg-subtle border border-border-faint flex items-center justify-center text-fg-muted mb-5 shadow-xs">
          {icon}
        </div>
      )}
      <h2 className="font-display text-base font-medium text-fg">{title}</h2>
      {description && (
        <div className="text-sm text-fg-muted mt-2 max-w-md leading-relaxed">
          {description}
        </div>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
