import { useEffect, useState } from 'react'
import { useLibraryStore } from '../../store/libraryStore'
import { useScanSSE } from '../../hooks/useScanSSE'
import { useSearchStore } from '../../store/searchStore'

export default function StatusBar() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const result = useLibraryStore((s) => s.result)
  const lastScanAt = useLibraryStore((s) => s.lastScanAt)
  const sse = useScanSSE()
  const query = useSearchStore((s) => s.query)
  const sortBy = useSearchStore((s) => s.sortBy)
  const view = useSearchStore((s) => s.view)

  let leftLabel = '就绪'
  if (sse.isRunning) {
    leftLabel = `扫描中 ${sse.progress?.progress ?? 0}% · 已发现 ${sse.progress?.albumsFound ?? 0} 相册`
  } else if (result) {
    leftLabel = `${result.albumCount} 相册 · ${result.smartCollections.length} 作者`
  }

  const sortLabel = sortBy === 'name' ? '名称' : sortBy === 'count' ? '张数' : '最近'
  const viewLabel =
    view === 'all' ? '全部' : view === 'album' ? '相册' : view === 'collection' ? '集合' : '作者'

  return (
    <footer className="h-7 px-4 flex items-center justify-between text-[11px] text-fg-subtle border-t border-border bg-bg-elevated/60 backdrop-blur">
      <div className="flex items-center gap-3 truncate">
        <span>{leftLabel}</span>
        {query && (
          <span className="px-1.5 py-0.5 rounded bg-bg-subtle text-fg-muted truncate">
            搜索: {query}
          </span>
        )}
        <span className="hidden md:inline">视图: {viewLabel}</span>
        <span className="hidden md:inline">排序: {sortLabel}</span>
      </div>
      <div className="flex items-center gap-3">
        {lastScanAt && (
          <span className="hidden md:inline">
            上次扫描 {new Date(lastScanAt).toLocaleTimeString()}
          </span>
        )}
        <span className="tabular-nums">{now.toLocaleTimeString()}</span>
      </div>
    </footer>
  )
}
