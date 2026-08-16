import { useEffect, useRef, useState } from 'react'
import { useSearchStore, type SortKey } from '../../store/searchStore'
import { useUIStore } from '../../store/uiStore'
import { ChevronDownIcon, GridIcon, ListIcon } from './Icon'

// 共享 filter strip: 视图 chips (可选) + 总数 + 排序 + 视图模式
// 取代原 toolbar 上分散的 4-5 个控件,让 list 页面更克制。
interface ListFilterBarProps {
  // 视图 chips (全部 / 文件夹 / 集合 / 标签),不需要就传 undefined
  viewChips?: { key: string; label: string; count: number }[]
  // 当前激活的 view chip key
  activeViewKey?: string
  onChangeView?: (key: string) => void
  // 总数(用于 "共 N 项")
  totalCount: number
}

export function ListFilterBar({
  viewChips,
  activeViewKey,
  onChangeView,
  totalCount,
}: ListFilterBarProps) {
  const sortBy = useSearchStore((s) => s.sortBy)
  const setSortBy = useSearchStore((s) => s.setSortBy)
  const viewMode = useUIStore((s) => s.viewMode)
  const setViewMode = useUIStore((s) => s.setViewMode)

  return (
    <div className="px-6 lg:px-10 max-w-[1400px] mx-auto w-full">
      <div className="flex items-center justify-between gap-3 border-t border-border-faint py-3">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {viewChips?.map((v) => {
            const active = activeViewKey === v.key
            return (
              <button
                key={v.key}
                onClick={() => onChangeView?.(v.key)}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12.5px] transition-colors ${
                  active
                    ? 'bg-bg-strong text-fg'
                    : 'text-fg-muted hover:bg-bg-subtle hover:text-fg'
                }`}
              >
                <span>{v.label}</span>
                <span className="tabular-nums text-[10.5px] opacity-60">{v.count}</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-fg-subtle tabular-nums">共 {totalCount} 项</span>
          <SortMenu value={sortBy} onChange={setSortBy} />
          <div className="flex items-center border border-border-faint rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              title="网格"
              aria-label="网格视图"
              className={`inline-flex items-center justify-center w-7 h-7 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-bg-subtle text-fg'
                  : 'text-fg-subtle hover:text-fg hover:bg-bg-subtle/60'
              }`}
            >
              <GridIcon size={12} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              title="列表"
              aria-label="列表视图"
              className={`inline-flex items-center justify-center w-7 h-7 transition-colors ${
                viewMode === 'list'
                  ? 'bg-bg-subtle text-fg'
                  : 'text-fg-subtle hover:text-fg hover:bg-bg-subtle/60'
              }`}
            >
              <ListIcon size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const sortOptions: { value: SortKey; label: string }[] = [
  { value: 'name', label: '按名称' },
  { value: 'count', label: '按张数' },
  { value: 'recent', label: '按最近' },
]

function SortMenu({
  value,
  onChange,
}: {
  value: SortKey
  onChange: (v: SortKey) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    setTimeout(() => {
      window.addEventListener('mousedown', onClick)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cur = sortOptions.find((o) => o.value === value) ?? sortOptions[0]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors border border-border-faint"
        title="排序"
        aria-label="排序"
      >
        <span>{cur.label}</span>
        <ChevronDownIcon size={10} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 min-w-[140px] bg-bg-elevated border border-border rounded-lg shadow-lg py-1 z-40 fade-up">
          {sortOptions.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                o.value === value
                  ? 'text-fg font-medium'
                  : 'text-fg-muted hover:bg-bg-subtle hover:text-fg'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
