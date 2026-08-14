import { useEffect, useRef } from 'react'

export interface MenuItem {
  id: string
  label: string
  icon?: string
  destructive?: boolean
  disabled?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onSelect: (id: string) => void
  onClose: () => void
}

// 极简右键菜单。点击外部 / Esc 关闭。
export default function ContextMenu({ x, y, items, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    setTimeout(() => {
      window.addEventListener('mousedown', fn)
      window.addEventListener('keydown', esc)
    }, 0)
    return () => {
      window.removeEventListener('mousedown', fn)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: y, left: x, zIndex: 1000 }}
      className="min-w-[160px] bg-bg-elevated border border-border rounded shadow-lg py-1"
    >
      {items.map((it) => (
        <button
          key={it.id}
          disabled={it.disabled}
          onClick={() => {
            if (!it.disabled) onSelect(it.id)
          }}
          className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
            it.disabled
              ? 'text-fg-subtle cursor-not-allowed'
              : it.destructive
                ? 'text-danger hover:bg-bg-subtle'
                : 'text-fg hover:bg-bg-subtle'
          }`}
        >
          {it.icon && <span>{it.icon}</span>}
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  )
}
