import { useEffect, useRef } from 'react'

export interface MenuItem {
  id: string
  label: string
  icon?: string
  destructive?: boolean
  disabled?: boolean
  separator?: never
}

export interface MenuSeparator {
  id: 'separator'
  separator: true
}

export type AnyMenuItem = MenuItem | MenuSeparator

interface Props {
  x: number
  y: number
  items: AnyMenuItem[]
  onSelect: (id: string) => void
  onClose: () => void
}

// 右键菜单：分隔符支持、边界检查、自动关闭。
// 当菜单越出视口边界时自动调整位置，避免被遮挡。
export default function ContextMenu({ x, y, items, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // 边界调整：菜单需要出现在视口内
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let nx = x
    let ny = y
    if (rect.right > window.innerWidth) nx = window.innerWidth - rect.width - 8
    if (rect.bottom > window.innerHeight) ny = window.innerHeight - rect.height - 8
    if (nx < 4) nx = 4
    if (ny < 4) ny = 4
    el.style.left = `${nx}px`
    el.style.top = `${ny}px`
  }, [x, y])

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
      className="min-w-[180px] bg-bg-elevated border border-border rounded shadow-lg py-1"
    >
      {items.map((it, i) =>
        'separator' in it ? (
          <div key={`sep-${i}`} className="my-1 border-t border-border" />
        ) : (
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
            {it.icon && <span className="w-4 text-center">{it.icon}</span>}
            <span>{it.label}</span>
          </button>
        ),
      )}
    </div>
  )
}