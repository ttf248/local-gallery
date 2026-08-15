import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSearchStore } from '../../store/searchStore'
import { useLibraryStore } from '../../store/libraryStore'
import { SearchIcon } from './Icon'
import { useDebounce } from '../../hooks/useDebounce'
import type { SearchHit } from '../../api/albums'

// 全局搜索框：输入时显示下拉建议（来自后端 /api/search）。
//   - 空结果时返回静默，仅同步过滤本地视图
//   - 回车跳转主页
export default function GlobalSearch() {
  const query = useSearchStore((s) => s.query)
  const setQuery = useSearchStore((s) => s.setQuery)
  const navigate = useNavigate()
  const result = useLibraryStore((s) => s.result)
  const loadFromBackend = useLibraryStore((s) => s.loadFromBackend)
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const debounced = useDebounce(query, 200)

  useEffect(() => {
    if (!debounced || debounced.length < 2) {
      setHits([])
      return
    }
    let cancelled = false
    fetch(`/api/search?q=${encodeURIComponent(debounced)}&limit=10`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setHits(d.results ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [debounced])

  function onPick(hit: SearchHit) {
    setOpen(false)
    setQuery('')
    navigate(`/albums/${encodeURIComponent(hit.path)}`)
  }

  return (
    <div className="relative w-full max-w-md">
      <div className="input-focus-ring flex items-center gap-2 bg-bg-subtle rounded-md px-3 h-9 focus-within:bg-bg-elevated focus-within:border focus-within:border-border-strong">
        <SearchIcon size={14} className="text-fg-subtle shrink-0" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!result) loadFromBackend()
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setOpen(false)
              navigate('/')
            }
            if (e.key === 'Escape') {
              setOpen(false)
              setQuery('')
            }
          }}
          placeholder="搜索文件夹 / 标签…"
          className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-fg-subtle"
        />
        <kbd className="hidden sm:inline-block kbd">/</kbd>
      </div>

      {open && hits.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-bg-elevated border border-border rounded-lg shadow-lg overflow-hidden z-30 fade-up py-1">
          {hits.map((h) => (
            <button
              key={h.path}
              onMouseDown={() => onPick(h)}
              className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-bg-subtle transition-colors"
            >
              {h.coverImage ? (
                <img
                  src={`/api/thumbs?path=${encodeURIComponent(h.coverImage)}`}
                  alt=""
                  className="w-8 h-10 object-cover rounded border border-border-faint"
                />
              ) : (
                <div className="w-8 h-10 bg-bg-subtle rounded border border-border-faint" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{h.name}</div>
                <div className="text-[11px] text-fg-subtle truncate">
                  {h.kind === 'album' ? '文件夹' : h.kind === 'smartCollection' ? '合集' : '集合'}
                  {' · '}
                  {h.count} {h.kind === 'album' ? '张' : '卷'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
