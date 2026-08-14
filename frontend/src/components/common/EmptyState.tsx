import { ReactNode } from 'react'

interface Props {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}

export default function EmptyState({ title, description, action, icon }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-10 text-center fade-up">
      {icon && (
        <div className="w-12 h-12 rounded-full bg-bg-subtle flex items-center justify-center text-fg-muted mb-4">
          {icon}
        </div>
      )}
      <h2 className="font-display text-lg font-medium text-fg">{title}</h2>
      {description && (
        <p className="text-sm text-fg-muted mt-2 max-w-md leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
